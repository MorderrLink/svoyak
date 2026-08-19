import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { initializeApplicationStorage } from "@/server/file-system/initialize-application-storage";

describe("initializeApplicationStorage", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, {
          force: true,
          recursive: true,
        });
      }),
    );
  });

  it("создаёт games/assets и проверяет возможность записи без мусора", async () => {
    const root = await mkdtemp(join(tmpdir(), "svoyak-storage-"));
    temporaryDirectories.push(root);
    const gamesDirectory = join(root, "games");

    const storage = await initializeApplicationStorage(gamesDirectory);

    expect(storage).toEqual({
      assetsDirectory: join(gamesDirectory, "assets"),
      gamesDirectory,
    });
    await expect(readdir(gamesDirectory)).resolves.toEqual(["assets"]);
    await expect(readdir(storage.assetsDirectory)).resolves.toEqual([]);
  });

  it("останавливает запуск с понятной ошибкой, если games создать нельзя", async () => {
    const root = await mkdtemp(join(tmpdir(), "svoyak-storage-"));
    temporaryDirectories.push(root);
    const occupiedPath = join(root, "not-a-directory");
    await writeFile(occupiedPath, "content", "utf8");

    await expect(
      initializeApplicationStorage(join(occupiedPath, "games")),
    ).rejects.toThrow("Не удалось подготовить games/assets");
    await expect(readFile(occupiedPath, "utf8")).resolves.toBe("content");
  });
});
