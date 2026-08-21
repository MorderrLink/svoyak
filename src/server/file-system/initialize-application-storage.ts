import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describeFileError } from "@/server/file-system/file-error";

export interface ApplicationStorage {
  assetsDirectory: string;
  gamesDirectory: string;
}

async function verifyDirectoryIsWritable(directory: string): Promise<void> {
  const probePath = resolve(
    directory,
    `.svoyak-write-test-${randomUUID()}.tmp`,
  );

  try {
    await writeFile(probePath, "", {
      flag: "wx",
    });
    await rm(probePath);
  } catch (error: unknown) {
    try {
      await rm(probePath, {
        force: true,
      });
    } catch {
      // Исходная ошибка точнее описывает причину неудачного первого запуска.
    }

    throw new Error(
      `Каталог ${directory} недоступен для записи: ${describeFileError(error)}`,
      {
        cause: error,
      },
    );
  }
}

export async function initializeApplicationStorage(
  gamesDirectory = resolve(process.cwd(), "games"),
): Promise<ApplicationStorage> {
  const resolvedGamesDirectory = resolve(gamesDirectory);
  const assetsDirectory = resolve(resolvedGamesDirectory, "assets");

  try {
    await mkdir(assetsDirectory, {
      recursive: true,
    });
  } catch (error: unknown) {
    throw new Error(
      `Не удалось подготовить games/assets: ${describeFileError(error)}`,
      {
        cause: error,
      },
    );
  }

  await verifyDirectoryIsWritable(resolvedGamesDirectory);
  await verifyDirectoryIsWritable(assetsDirectory);

  return {
    assetsDirectory,
    gamesDirectory: resolvedGamesDirectory,
  };
}
