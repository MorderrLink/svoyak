import { randomUUID } from "node:crypto";

import { io as connectSocket } from "socket.io-client";
import { describe, expect, it } from "vitest";

import { createHttpServer } from "@/server/http/create-http-server";
import { RoomManager } from "@/server/room/room-manager";
import { registerSocketHandlers } from "@/server/socket/register-socket-handlers";
import { SocketSecurity } from "@/server/socket/socket-security";
import type {
  ClientToServerEvents,
  CommandResult,
  DisplayRoomState,
  PlayerScreenState,
  ReconnectPlayerResult,
  ServerToClientEvents,
  SocketResult,
} from "@/shared/contracts/socket";
import type { QuizConfig } from "@/shared/types/quiz";

import type { Server as NodeHttpServer } from "node:http";
import type { Socket as ClientSocket } from "socket.io-client";

type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

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
                answer: "Скрытый ответ",
                content: { text: "Публичный вопрос" },
                hostComment: "Приватный комментарий",
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
      questionIntroSeconds: 0,
      showScoresToPlayers: true,
    },
    slug: "socket-integration",
    title: "Socket integration",
    updatedAt: "2026-07-30T08:00:00.000Z",
  };
}

async function listen(httpServer: NodeHttpServer): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("HTTP-сервер не вернул порт");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function connect(url: string): Promise<TestClient> {
  const client: TestClient = connectSocket(url, {
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });
  await new Promise<void>((resolve, reject) => {
    client.once("connect", resolve);
    client.once("connect_error", reject);
  });
  return client;
}

async function closeServer(
  io: ReturnType<typeof createHttpServer>["io"],
  httpServer: NodeHttpServer,
): Promise<void> {
  await io.close();
  if (httpServer.listening) {
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  }
}

describe("Socket.IO integration", () => {
  it("восстанавливает игрока и выдаёт display только публичное состояние", async () => {
    const manager = new RoomManager({
      codeGenerator: () => "A7K4",
      idGenerator: randomUUID,
      tokenGenerator: randomUUID,
    });
    const room = manager.createRoom(createQuiz());
    const player = manager.addPlayer(room.roomCode, "Анна", "old-socket");
    manager.startSession(room.roomCode, room.hostToken);
    manager.selectQuestion(room.roomCode, room.hostToken, questionId);
    manager.completeQuestionIntro(room.roomCode);
    const { httpServer, io } = createHttpServer((_request, response) => {
      response.end("ok");
    });
    const dispose = registerSocketHandlers(io, manager, {
      applicationUrls: [],
    });
    const url = await listen(httpServer);
    const playerClient = await connect(url);
    const displayClient = await connect(url);

    try {
      const playerStatePromise = new Promise<PlayerScreenState>((resolve) => {
        playerClient.once("player:state", resolve);
      });
      const reconnectResult = await new Promise<
        SocketResult<ReconnectPlayerResult>
      >((resolve) => {
        playerClient.emit(
          "player:reconnect",
          {
            playerToken: player.playerToken,
            roomCode: room.roomCode,
          },
          resolve,
        );
      });
      expect(reconnectResult).toMatchObject({
        data: {
          playerId: player.playerId,
        },
        ok: true,
      });
      await expect(playerStatePromise).resolves.toMatchObject({
        buzzer: { position: null },
        name: "Анна",
        phase: "buzzing",
        score: 0,
      });

      const displayStatePromise = new Promise<DisplayRoomState>((resolve) => {
        displayClient.once("display:state", resolve);
      });
      const attachResult = await new Promise<SocketResult<CommandResult>>(
        (resolve) => {
          displayClient.emit(
            "room:attach-display",
            { roomCode: room.roomCode },
            resolve,
          );
        },
      );
      expect(attachResult.ok).toBe(true);
      const displayState = await displayStatePromise;
      expect(displayState.game?.activeQuestion).toMatchObject({
        answer: null,
        text: "Публичный вопрос",
      });
      expect(JSON.stringify(displayState)).not.toContain("Скрытый ответ");
      expect(JSON.stringify(displayState)).not.toContain(
        "Приватный комментарий",
      );
      expect(displayState).not.toHaveProperty("players");

      const unauthorized = await new Promise<SocketResult<CommandResult>>(
        (resolve) => {
          displayClient.emit(
            "session:finish",
            {
              hostToken: randomUUID(),
              roomCode: room.roomCode,
            },
            resolve,
          );
        },
      );
      expect(unauthorized).toMatchObject({
        error: { code: "HOST_UNAUTHORIZED" },
        ok: false,
      });
    } finally {
      playerClient.disconnect();
      displayClient.disconnect();
      dispose();
      await closeServer(io, httpServer);
    }
  });

  it("возвращает RATE_LIMITED через callback", async () => {
    const manager = new RoomManager();
    const { httpServer, io } = createHttpServer((_request, response) => {
      response.end("ok");
    });
    const security = new SocketSecurity(undefined, {
      socketEventLimit: 1,
      socketEventWindowMs: 10_000,
    });
    const dispose = registerSocketHandlers(io, manager, {
      applicationUrls: [],
      security,
    });
    const url = await listen(httpServer);
    const client = await connect(url);

    try {
      await new Promise<SocketResult<{ exists: boolean; roomCode: string }>>(
        (resolve) => {
          client.emit("room:check", { roomCode: "A7K4" }, resolve);
        },
      );
      const limited = await new Promise<
        SocketResult<{ exists: boolean; roomCode: string }>
      >((resolve) => {
        client.emit("room:check", { roomCode: "A7K4" }, resolve);
      });
      expect(limited).toMatchObject({
        error: { code: "RATE_LIMITED" },
        ok: false,
      });
    } finally {
      client.disconnect();
      dispose();
      await closeServer(io, httpServer);
    }
  });
});
