import { describe, expect, it } from "vitest";

import { RoomError } from "@/server/room/room-error";
import { RoomManager } from "@/server/room/room-manager";
import { roomNameSchema } from "@/shared/schemas/socket";

function expectRoomError(operation: () => void, code: RoomError["code"]) {
  try {
    operation();
    throw new Error("Ожидалась ошибка RoomError");
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(RoomError);

    if (error instanceof RoomError) {
      expect(error.code).toBe(code);
    }
  }
}

function createManager(now: () => number = () => 1_000) {
  let id = 0;
  let token = 0;

  return new RoomManager({
    codeGenerator: () => "A7K4",
    idGenerator: () => `id-${++id}`,
    now,
    tokenGenerator: () => `token-${++token}`,
  });
}

describe("RoomManager", () => {
  it("повторяет генерацию, пока не получит уникальный код", () => {
    const codes = ["A7K4", "A7K4", "B8M5"];
    let codeIndex = 0;
    const manager = new RoomManager({
      codeGenerator: () => codes[codeIndex++] ?? "C9N6",
    });

    expect(manager.createRoom().roomCode).toBe("A7K4");
    expect(manager.createRoom().roomCode).toBe("B8M5");
  });

  it("подключает игрока и запрещает одинаковые имена без учёта регистра", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const player = manager.addPlayer(room.roomCode, "Алексей", "socket-1");

    expect(
      manager.getPlayerState(room.roomCode, player.playerId),
    ).toMatchObject({
      connected: true,
      name: "Алексей",
      score: 0,
    });
    expect(manager.getHostState(room.roomCode).players[0]).toMatchObject({
      device: "Неизвестное устройство",
      joinedAt: 1_000,
      pingMs: null,
    });
    expectRoomError(
      () => manager.addPlayer(room.roomCode, "алексей", "socket-2"),
      "NAME_TAKEN",
    );
  });

  it("нормализует имя и ограничивает его двадцатью символами", () => {
    expect(roomNameSchema.parse("  Анна     Мария  ")).toBe("Анна Мария");
    expect(roomNameSchema.safeParse(" ".repeat(10)).success).toBe(false);
    expect(roomNameSchema.safeParse("а".repeat(21)).success).toBe(false);

    const manager = createManager();
    const room = manager.createRoom();
    const player = manager.addPlayer(
      room.roomCode,
      "  Анна     Мария  ",
      "socket-1",
    );
    expect(manager.getPlayerState(room.roomCode, player.playerId).name).toBe(
      "Анна Мария",
    );
  });

  it("позволяет ведущему одновременно изменить имя и баллы игрока", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const first = manager.addPlayer(room.roomCode, "Первый", "socket-1");
    manager.addPlayer(room.roomCode, "Второй", "socket-2");

    manager.updatePlayer(
      room.roomCode,
      room.hostToken,
      first.playerId,
      "  Новое    имя ",
      200,
    );

    expect(manager.getPlayerState(room.roomCode, first.playerId)).toMatchObject(
      {
        name: "Новое имя",
        score: 200,
      },
    );
    expectRoomError(
      () =>
        manager.updatePlayer(
          room.roomCode,
          room.hostToken,
          first.playerId,
          "второй",
          0,
        ),
      "NAME_TAKEN",
    );
  });

  it("обновляет ping только для текущего подключения игрока", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const player = manager.addPlayer(room.roomCode, "Игрок", "socket-1", {
      device: "iPhone · Safari",
    });

    manager.updatePlayerPing(room.roomCode, player.playerId, "socket-1", 42);
    expect(manager.getHostState(room.roomCode).players[0]).toMatchObject({
      connected: true,
      device: "iPhone · Safari",
      pingMs: 42,
    });
    expectRoomError(
      () =>
        manager.updatePlayerPing(
          room.roomCode,
          player.playerId,
          "old-socket",
          10,
        ),
      "PLAYER_UNAUTHORIZED",
    );
  });

  it("позволяет ведущему вручную корректировать баллы вне вопроса", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const player = manager.addPlayer(room.roomCode, "Игрок", "socket-1");

    manager.adjustPlayerScore(
      room.roomCode,
      room.hostToken,
      player.playerId,
      300,
    );

    expect(
      manager.getPlayerState(room.roomCode, player.playerId),
    ).toMatchObject({
      answerDelta: null,
      score: 300,
    });
  });

  it("принимает несколько нажатий и сохраняет их порядок", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const firstPlayer = manager.addPlayer(room.roomCode, "Первый", "socket-1");
    const secondPlayer = manager.addPlayer(room.roomCode, "Второй", "socket-2");
    const window = manager.openBuzzer(room.roomCode, room.hostToken, 5_000);

    manager.pressBuzzer(
      room.roomCode,
      firstPlayer.playerToken,
      window.buzzWindowId,
    );
    manager.pressBuzzer(
      room.roomCode,
      secondPlayer.playerToken,
      window.buzzWindowId,
    );

    const state = manager.getHostState(room.roomCode);
    expect(state.buzzer).toMatchObject({
      status: "open",
      winner: null,
    });
    expect(state.players).toEqual([
      expect.objectContaining({ buzzPosition: 1, name: "Первый" }),
      expect.objectContaining({ buzzPosition: 2, name: "Второй" }),
    ]);
    expect(
      manager.getPlayerState(room.roomCode, firstPlayer.playerId).buzzer,
    ).toMatchObject({ position: 1, status: "queued" });
    expect(
      manager.getPlayerState(room.roomCode, secondPlayer.playerId).buzzer,
    ).toMatchObject({ position: 2, status: "queued" });
  });

  it("отклоняет повторное событие одного игрока", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const player = manager.addPlayer(room.roomCode, "Игрок", "socket-1");
    const window = manager.openBuzzer(room.roomCode, room.hostToken, 5_000);

    manager.pressBuzzer(room.roomCode, player.playerToken, window.buzzWindowId);

    expectRoomError(
      () =>
        manager.pressBuzzer(
          room.roomCode,
          player.playerToken,
          window.buzzWindowId,
        ),
      "BUZZ_ALREADY_PRESSED",
    );
  });

  it("отклоняет идентификатор предыдущего окна", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const player = manager.addPlayer(room.roomCode, "Игрок", "socket-1");
    const oldWindow = manager.openBuzzer(room.roomCode, room.hostToken, 5_000);
    manager.openBuzzer(room.roomCode, room.hostToken, 5_000);

    expectRoomError(
      () =>
        manager.pressBuzzer(
          room.roomCode,
          player.playerToken,
          oldWindow.buzzWindowId,
        ),
      "BUZZ_WINDOW_MISMATCH",
    );
  });

  it("отклоняет нажатие после серверного времени окончания", () => {
    let now = 1_000;
    const manager = createManager(() => now);
    const room = manager.createRoom();
    const player = manager.addPlayer(room.roomCode, "Игрок", "socket-1");
    const window = manager.openBuzzer(room.roomCode, room.hostToken, 1_000);
    now = 2_001;

    expectRoomError(
      () =>
        manager.pressBuzzer(
          room.roomCode,
          player.playerToken,
          window.buzzWindowId,
        ),
      "BUZZ_WINDOW_EXPIRED",
    );
    expect(
      manager.getPlayerState(room.roomCode, player.playerId).buzzer.status,
    ).toBe("time-expired");
  });

  it("восстанавливает отключённого игрока по токену", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const player = manager.addPlayer(room.roomCode, "Игрок", "socket-1");

    manager.disconnectPlayer(room.roomCode, player.playerId, "socket-1");
    expect(
      manager.getPlayerState(room.roomCode, player.playerId).connected,
    ).toBe(false);

    manager.reconnectPlayer(room.roomCode, player.playerToken, "socket-2");
    expect(
      manager.getPlayerState(room.roomCode, player.playerId).connected,
    ).toBe(true);
  });

  it("учитывает подключённый публичный экран при очистке комнат", () => {
    let now = 1_000;
    const manager = createManager(() => now);
    const room = manager.createRoom();

    manager.attachDisplay(room.roomCode, "display-1");
    now = 10_000;
    expect(manager.deleteInactiveRooms(1_000)).toEqual([]);

    manager.disconnectDisplay(room.roomCode, "display-1");
    now = 20_000;
    expect(manager.deleteInactiveRooms(1_000)).toEqual([room.roomCode]);
  });

  it("стабильно обслуживает комнату с 20 игроками", () => {
    const manager = createManager();
    const room = manager.createRoom();
    const players = Array.from({ length: 20 }, (_, index) =>
      manager.addPlayer(
        room.roomCode,
        `Игрок ${index + 1}`,
        `socket-${index + 1}`,
      ),
    );
    const window = manager.openBuzzer(room.roomCode, room.hostToken, 5_000);

    manager.pressBuzzer(
      room.roomCode,
      players[19]!.playerToken,
      window.buzzWindowId,
    );

    expect(manager.getHostState(room.roomCode).players).toHaveLength(20);
    expect(manager.getPublicRoomState(room.roomCode)).toMatchObject({
      buzzerStatus: "open",
      connectedPlayerCount: 20,
    });
    expect(
      manager
        .getHostState(room.roomCode)
        .players.find((player) => player.name === "Игрок 20"),
    ).toMatchObject({ buzzPosition: 1 });
  });
});
