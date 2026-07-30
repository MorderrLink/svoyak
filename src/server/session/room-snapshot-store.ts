import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { RoomManager } from "@/server/room/room-manager";
import {
  activeRoomsSnapshotSchema,
  type ActiveRoomsSnapshot,
} from "@/server/session/session-snapshot";

const defaultSaveIntervalMs = 30_000;
const defaultSaveDebounceMs = 250;

function getErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error) {
    const code: unknown = error.code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function describeStorageError(error: unknown): string {
  switch (getErrorCode(error)) {
    case "EACCES":
    case "EPERM":
    case "EROFS":
      return "нет прав записи в каталог активных сессий";
    case "ENOSPC":
      return "на диске закончилось свободное место";
    case "ENOENT":
      return "каталог активных сессий недоступен";
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

export class RoomSnapshotStore {
  private readonly directory: string;
  private readonly filePath: string;

  constructor(gamesDirectory = resolve(process.cwd(), "games")) {
    this.directory = resolve(gamesDirectory, ".sessions");
    this.filePath = resolve(this.directory, "active-rooms.json");
  }

  getPath(): string {
    return this.filePath;
  }

  async load(): Promise<ActiveRoomsSnapshot | null> {
    let source: string;

    try {
      source = await readFile(this.filePath, "utf8");
    } catch (error: unknown) {
      if (getErrorCode(error) === "ENOENT") {
        return null;
      }
      console.error(
        `Не удалось прочитать snapshot активных комнат: ${describeStorageError(error)}`,
      );
      return null;
    }

    try {
      const json: unknown = JSON.parse(source);
      const parsed = activeRoomsSnapshotSchema.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Некорректный snapshot",
        );
      }
      return parsed.data;
    } catch (error: unknown) {
      console.error("Snapshot активных комнат повреждён:", error);
      await this.quarantineCorruptedSnapshot();
      return null;
    }
  }

  async save(snapshot: ActiveRoomsSnapshot): Promise<void> {
    const parsed = activeRoomsSnapshotSchema.safeParse(snapshot);
    if (!parsed.success) {
      throw new Error(
        parsed.error.issues[0]?.message ??
          "Нельзя сохранить некорректный snapshot",
      );
    }

    await mkdir(this.directory, { recursive: true });
    const temporaryPath = resolve(
      this.directory,
      `.active-rooms.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(parsed.data, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
      await rename(temporaryPath, this.filePath);
    } catch (error: unknown) {
      throw new Error(
        `Не удалось сохранить активные комнаты: ${describeStorageError(error)}`,
        { cause: error },
      );
    } finally {
      try {
        await rm(temporaryPath, { force: true });
      } catch (cleanupError: unknown) {
        console.warn(
          `Не удалось очистить временный snapshot: ${describeStorageError(cleanupError)}`,
        );
      }
    }
  }

  private async quarantineCorruptedSnapshot(): Promise<void> {
    const destination = resolve(
      this.directory,
      `active-rooms.corrupted-${Date.now()}.json`,
    );
    try {
      await rename(this.filePath, destination);
      console.warn(`Повреждённый snapshot перемещён в ${destination}`);
    } catch (error: unknown) {
      console.warn(
        `Не удалось изолировать повреждённый snapshot: ${describeStorageError(error)}`,
      );
    }
  }
}

export interface RoomSnapshotPersistenceOptions {
  saveDebounceMs?: number;
  saveIntervalMs?: number;
}

export class RoomSnapshotPersistence {
  private debounceTimer: NodeJS.Timeout | null = null;
  private dirty = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private pendingSave: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  private readonly saveDebounceMs: number;
  private readonly saveIntervalMs: number;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly store: RoomSnapshotStore,
    options: RoomSnapshotPersistenceOptions = {},
  ) {
    this.saveDebounceMs = options.saveDebounceMs ?? defaultSaveDebounceMs;
    this.saveIntervalMs = options.saveIntervalMs ?? defaultSaveIntervalMs;
  }

  start(): void {
    if (this.unsubscribe !== null) {
      return;
    }
    this.unsubscribe = this.roomManager.subscribeToChanges(() => {
      this.schedule();
    });
    this.intervalTimer = setInterval(() => {
      if (this.dirty) {
        void this.flush();
      }
    }, this.saveIntervalMs);
  }

  schedule(): void {
    this.dirty = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.saveDebounceMs);
  }

  async flush(): Promise<void> {
    if (!this.dirty) {
      await this.pendingSave;
      return;
    }

    this.dirty = false;
    const snapshot = this.roomManager.createSnapshot();
    this.pendingSave = this.pendingSave
      .then(async () => {
        await this.store.save(snapshot);
      })
      .catch((error: unknown) => {
        this.dirty = true;
        console.error("Ошибка периодического snapshot:", error);
      });
    await this.pendingSave;
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    await this.flush();
  }
}
