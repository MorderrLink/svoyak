import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SessionEventJournal } from "@/server/session/session-event-journal";
import { SocketSecurity } from "@/server/socket/socket-security";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

describe("защита Socket.IO", () => {
  it("не задерживает первые события и ограничивает последующий поток", () => {
    let now = 1_000;
    const security = new SocketSecurity(
      undefined,
      {
        socketEventLimit: 2,
        socketEventWindowMs: 1_000,
      },
      () => now,
    );

    expect(security.checkSocketEvent("socket-1", "first").allowed).toBe(true);
    expect(security.checkSocketEvent("socket-1", "second").allowed).toBe(true);
    expect(security.checkSocketEvent("socket-1", "third")).toMatchObject({
      allowed: false,
      retryAfterMs: 1_000,
    });

    now = 2_001;
    expect(security.checkSocketEvent("socket-1", "fourth").allowed).toBe(true);
  });

  it("принимает только одно событие игрока для окна и вводит cooldown", () => {
    let now = 1_000;
    const security = new SocketSecurity(
      undefined,
      {
        closedPressCooldownMs: 500,
      },
      () => now,
    );
    const token = "00000000-0000-4000-8000-000000000001";

    expect(security.checkPlayerPress(token, "window-1", "A7K4").allowed).toBe(
      true,
    );
    security.markAcceptedPress(token, "window-1");
    expect(security.checkPlayerPress(token, "window-1", "A7K4").allowed).toBe(
      false,
    );

    security.markClosedPress(token);
    expect(security.checkPlayerPress(token, "window-2", "A7K4")).toMatchObject({
      allowed: false,
      retryAfterMs: 500,
    });
    now = 1_501;
    expect(security.checkPlayerPress(token, "window-2", "A7K4").allowed).toBe(
      true,
    );
  });

  it("отключает сокет после предела ошибок", () => {
    const security = new SocketSecurity(undefined, {
      errorLimit: 2,
      errorWindowMs: 1_000,
    });

    expect(security.recordError("socket-1", "INVALID_PAYLOAD")).toBe(false);
    expect(security.recordError("socket-1", "INVALID_PAYLOAD")).toBe(false);
    expect(security.recordError("socket-1", "INVALID_PAYLOAD")).toBe(true);
  });
});

describe("журнал игровой сессии", () => {
  it("пишет JSONL и отбрасывает секретные поля", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "svoyak-journal-"));
    temporaryDirectories.push(directory);
    const journal = new SessionEventJournal(
      directory,
      () => new Date("2026-07-30T10:00:00.000Z"),
    );

    journal.record({
      details: {
        hostToken: "secret",
        playerName: "Анна",
      },
      roomCode: "A7K4",
      type: "player_connected",
    });
    await journal.flush();

    const source = await readFile(
      resolve(directory, ".sessions/logs/2026-07-30.jsonl"),
      "utf8",
    );
    expect(source).toContain('"playerName":"Анна"');
    expect(source).not.toContain("hostToken");
    expect(source).not.toContain("secret");
  });
});
