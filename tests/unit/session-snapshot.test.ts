import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RoomManager } from "@/server/room/room-manager";
import {
  RoomSnapshotPersistence,
  RoomSnapshotStore,
} from "@/server/session/room-snapshot-store";
import type { QuizConfig } from "@/shared/types/quiz";

const temporaryDirectories: string[] = [];
const questionId = "00000000-0000-4000-8000-000000000004";

function createQuiz(): QuizConfig {
  return {
    createdAt: "2026-07-30T08:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    rounds: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        order: 0,
        themes: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            order: 0,
            questions: [
              {
                answer: "Ответ",
                content: { text: "Вопрос" },
                id: questionId,
                price: 100,
              },
            ],
            title: "Тема",
          },
        ],
      },
    ],
    schemaVersion: 1,
    settings: {
      allowNegativeScore: true,
      answerRevealSeconds: 5,
      answerSeconds: 15,
      buzzSeconds: 10,
      questionIntroSeconds: 2,
      showScoresToPlayers: true,
    },
    slug: "snapshot-test",
    title: "Snapshot test",
    updatedAt: "2026-07-30T08:00:00.000Z",
  };
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), "svoyak-snapshot-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("snapshot активной комнаты", () => {
  it("восстанавливает фазу, баллы, попытки и доступ по исходным токенам", () => {
    let now = 1_000;
    let id = 10;
    const options = {
      codeGenerator: () => "A7K4",
      idGenerator: () =>
        `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
      now: () => now,
      tokenGenerator: () =>
        `10000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
    };
    const manager = new RoomManager(options);
    const room = manager.createRoom(createQuiz());
    const player = manager.addPlayer(room.roomCode, "Анна", "socket-player");
    manager.addPlayer(room.roomCode, "Борис", "socket-second-player");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, questionId);
    const firstWindow = manager.completeQuestionIntro(room.roomCode);
    manager.pressBuzzer(
      room.roomCode,
      player.playerToken,
      firstWindow.buzzWindowId,
    );
    manager.judgeAnswer(room.roomCode, room.hostToken, "incorrect");
    const proposal = manager.getHostState(room.roomCode).game?.scoreProposal;
    manager.confirmScore(
      room.roomCode,
      room.hostToken,
      proposal!.id,
      proposal!.suggestedDelta,
    );

    const snapshot = manager.createSnapshot();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain(room.hostToken);
    expect(serialized).not.toContain(player.playerToken);
    expect(snapshot.rooms[0]?.session?.scoreOperations).toHaveLength(1);

    now = 2_000;
    const restored = new RoomManager(options);
    expect(restored.restoreSnapshot(snapshot)).toEqual(["A7K4"]);
    expect(restored.getPlayerState("A7K4", player.playerId)).toMatchObject({
      connected: false,
      score: -100,
    });

    restored.attachHost("A7K4", room.hostToken, "new-host");
    restored.reconnectPlayer("A7K4", player.playerToken, "new-player");
    expect(restored.getPlayerState("A7K4", player.playerId)).toMatchObject({
      connected: true,
      score: -100,
    });
    expect(restored.getHostState("A7K4").game).toMatchObject({
      activeQuestion: {
        attemptedPlayerIds: [player.playerId],
      },
      phase: "buzzing",
      timer: {
        endsAt: 11_000,
        startedAt: 1_000,
      },
    });
  });

  it("продвигает только уже истёкшую автоматическую фазу", () => {
    let now = 1_000;
    const manager = new RoomManager({
      codeGenerator: () => "A7K4",
      now: () => now,
    });
    const room = manager.createRoom(createQuiz());
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, questionId);
    const snapshot = manager.createSnapshot();

    now = 4_000;
    const restored = new RoomManager({ now: () => now });
    restored.restoreSnapshot(snapshot);
    expect(restored.reconcileExpiredTimers()).toEqual(["A7K4"]);
    expect(restored.getHostState("A7K4")).toMatchObject({
      buzzer: {
        status: "open",
        timer: {
          endsAt: 14_000,
          startedAt: 4_000,
        },
      },
      game: {
        phase: "buzzing",
      },
    });
  });

  it("атомарно сохраняет и валидирует файл", async () => {
    const directory = await createTemporaryDirectory();
    const manager = new RoomManager({ codeGenerator: () => "A7K4" });
    manager.createRoom(createQuiz());
    const store = new RoomSnapshotStore(directory);

    await store.save(manager.createSnapshot());
    await expect(store.load()).resolves.toMatchObject({
      rooms: [{ code: "A7K4" }],
      schemaVersion: 1,
    });
    expect(await readFile(store.getPath(), "utf8")).toContain(
      '"schemaVersion": 1',
    );
  });

  it("изолирует повреждённый файл и продолжает запуск", async () => {
    const directory = await createTemporaryDirectory();
    const sessionsDirectory = resolve(directory, ".sessions");
    await mkdir(sessionsDirectory, { recursive: true });
    await writeFile(
      resolve(sessionsDirectory, "active-rooms.json"),
      "{broken",
      "utf8",
    );
    const store = new RoomSnapshotStore(directory);

    await expect(store.load()).resolves.toBeNull();
    await expect(readFile(store.getPath(), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("сохраняет изменения RoomManager через подписку", async () => {
    const directory = await createTemporaryDirectory();
    const manager = new RoomManager({ codeGenerator: () => "A7K4" });
    const store = new RoomSnapshotStore(directory);
    const persistence = new RoomSnapshotPersistence(manager, store, {
      saveDebounceMs: 60_000,
      saveIntervalMs: 60_000,
    });
    persistence.start();

    manager.createRoom(createQuiz());
    await persistence.flush();
    await expect(store.load()).resolves.toMatchObject({
      rooms: [{ code: "A7K4" }],
    });
    await persistence.stop();
  });
});
