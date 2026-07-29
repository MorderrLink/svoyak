import { describe, expect, it } from "vitest";

import { RoomError } from "@/server/room/room-error";
import { RoomManager } from "@/server/room/room-manager";

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
    expectRoomError(
      () => manager.addPlayer(room.roomCode, "алексей", "socket-2"),
      "NAME_TAKEN",
    );
  });

  it("атомарно принимает только первое нажатие", () => {
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

    expect(manager.getHostState(room.roomCode).buzzer.winner?.name).toBe(
      "Первый",
    );
    expectRoomError(
      () =>
        manager.pressBuzzer(
          room.roomCode,
          secondPlayer.playerToken,
          window.buzzWindowId,
        ),
      "BUZZ_ALREADY_WON",
    );
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
});
