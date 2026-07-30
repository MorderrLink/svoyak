import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";

import { Open } from "unzipper";

import {
  getReferencedAssetPaths,
  rewriteQuizAssetPaths,
  validateImageSource,
} from "@/server/media/asset-storage";
import {
  createPackageIntegrity,
  verifyPackageIntegrity,
} from "@/server/package/integrity";
import type { QuizRepository } from "@/server/quiz/quiz-repository";
import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { quizConfigSchema } from "@/shared/schemas/quiz";
import type { QuizConfig } from "@/shared/types/quiz";

const packageLimits = {
  archiveBytes: 50 * 1_024 * 1_024,
  configBytes: 5 * 1_024 * 1_024,
  fileCount: 200,
  totalUncompressedBytes: 100 * 1_024 * 1_024,
} as const;

export type ImportConflictStrategy = "copy" | "error" | "replace";

interface ValidatedPackage {
  assets: Map<string, Buffer>;
  quiz: QuizConfig;
}

export function assertSafeArchivePath(path: string): void {
  if (
    path === "" ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path) ||
    path.split("/").includes("..")
  ) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      `Недопустимый путь в архиве: ${path}`,
    );
  }

  const comparable = path.endsWith("/") ? path.slice(0, -1) : path;
  if (posix.normalize(comparable) !== comparable) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      `Неканонический путь в архиве: ${path}`,
    );
  }
}

function isSymbolicLink(externalFileAttributes: number): boolean {
  const unixMode = (externalFileAttributes >>> 16) & 0o170000;
  return unixMode === 0o120000;
}

export async function validateQuizPackage(
  source: Buffer,
): Promise<ValidatedPackage> {
  if (source.byteLength > packageLimits.archiveBytes) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "ZIP-архив не должен быть больше 50 МБ",
    );
  }

  let archive: Awaited<ReturnType<typeof Open.buffer>>;
  try {
    archive = await Open.buffer(source);
  } catch (error: unknown) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      `Не удалось открыть ZIP-архив: ${String(error)}`,
    );
  }

  if (
    archive.files.length === 0 ||
    archive.files.length > packageLimits.fileCount
  ) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Некорректное количество файлов в архиве",
    );
  }

  const seenPaths = new Set<string>();
  let totalUncompressedBytes = 0;
  let hasAssetsRoot = false;
  const rootJsonFiles: typeof archive.files = [];
  const assetFiles: typeof archive.files = [];

  for (const entry of archive.files) {
    assertSafeArchivePath(entry.path);
    const comparablePath = entry.path.toLocaleLowerCase("en-US");

    if (seenPaths.has(comparablePath)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        `Дублирующийся путь в архиве: ${entry.path}`,
      );
    }
    seenPaths.add(comparablePath);

    if (isSymbolicLink(entry.externalFileAttributes)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Символические ссылки в архиве запрещены",
      );
    }

    totalUncompressedBytes += entry.uncompressedSize;
    if (totalUncompressedBytes > packageLimits.totalUncompressedBytes) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Распакованные данные превышают допустимый размер",
      );
    }

    if (
      entry.uncompressedSize > 1_000_000 &&
      entry.uncompressedSize / Math.max(1, entry.compressedSize) > 200
    ) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Архив отклонён как потенциальный ZIP Bomb",
      );
    }

    if (entry.path === "assets/" && entry.type === "Directory") {
      hasAssetsRoot = true;
      continue;
    }

    if (!entry.path.includes("/") && entry.type === "File") {
      if (!entry.path.endsWith(".json")) {
        throw new QuizRepositoryError(
          "QUIZ_VALIDATION_ERROR",
          "В корне ZIP разрешён только один JSON и каталог assets",
        );
      }
      rootJsonFiles.push(entry);
      continue;
    }

    if (entry.path.startsWith("assets/")) {
      if (entry.type === "File") {
        assetFiles.push(entry);
      }
      continue;
    }

    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      `Лишний корневой элемент: ${entry.path}`,
    );
  }

  if (!hasAssetsRoot || rootJsonFiles.length !== 1) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "ZIP должен содержать один JSON и один корневой каталог assets/",
    );
  }

  const configEntry = rootJsonFiles[0];
  if (
    configEntry === undefined ||
    configEntry.uncompressedSize > packageLimits.configBytes
  ) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Конфиг отсутствует или слишком велик",
    );
  }

  let json: unknown;
  try {
    json = JSON.parse((await configEntry.buffer()).toString("utf8")) as unknown;
  } catch {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Конфиг архива содержит некорректный JSON",
    );
  }

  const parsed = quizConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      parsed.error.issues[0]?.message ?? "Конфиг архива не прошёл проверку",
    );
  }
  const quiz = parsed.data;

  if (configEntry.path !== `${quiz.slug}.json`) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Имя JSON не соответствует slug викторины",
    );
  }

  const assets = new Map<string, Buffer>();
  for (const entry of assetFiles) {
    const buffer = await entry.buffer();
    await validateImageSource(buffer);
    assets.set(entry.path, buffer);
  }

  const referenced = [...getReferencedAssetPaths(quiz)].sort();
  const packagedPaths = [...assets.keys()].sort();
  if (JSON.stringify(referenced) !== JSON.stringify(packagedPaths)) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Набор изображений не соответствует ссылкам в конфиге",
    );
  }

  verifyPackageIntegrity(quiz, assets);
  return {
    assets,
    quiz,
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createCopy(
  validated: ValidatedPackage,
  repository: QuizRepository,
): Promise<ValidatedPackage> {
  const source = validated.quiz;
  let suffix = 2;
  let slug = `${source.slug}-${suffix}`;

  while (await repository.slugExists(slug)) {
    suffix += 1;
    slug = `${source.slug}-${suffix}`;
  }

  const timestamp = new Date().toISOString();
  let quiz: QuizConfig = {
    ...structuredClone(source),
    createdAt: timestamp,
    id: randomUUID(),
    rounds: source.rounds.map((round) => ({
      ...structuredClone(round),
      id: randomUUID(),
      themes: round.themes.map((theme) => ({
        ...structuredClone(theme),
        id: randomUUID(),
        questions: theme.questions.map((question) => ({
          ...structuredClone(question),
          id: randomUUID(),
        })),
      })),
    })),
    slug,
    title: `${source.title} — копия`,
    updatedAt: timestamp,
  };
  quiz = rewriteQuizAssetPaths(quiz, source.slug, slug);

  const oldPrefix = `assets/${source.slug}/`;
  const newPrefix = `assets/${slug}/`;
  const assets = new Map(
    [...validated.assets].map(([path, buffer]) => [
      `${newPrefix}${path.slice(oldPrefix.length)}`,
      buffer,
    ]),
  );
  quiz.packageIntegrity = createPackageIntegrity(quiz, assets);
  return {
    assets,
    quiz: quizConfigSchema.parse(quiz),
  };
}

export async function importQuizPackage(
  source: Buffer,
  repository: QuizRepository,
  strategy: ImportConflictStrategy,
): Promise<QuizConfig> {
  let validated = await validateQuizPackage(source);
  const existingBySlug = await repository.findBySlug(validated.quiz.slug);

  if (existingBySlug !== undefined && strategy === "error") {
    throw new QuizRepositoryError(
      "QUIZ_SLUG_CONFLICT",
      "Викторина с таким slug уже существует",
    );
  }
  if (existingBySlug !== undefined && strategy === "copy") {
    validated = await createCopy(validated, repository);
  }

  try {
    const existingById = await repository.get(validated.quiz.id);
    if (existingById.slug !== validated.quiz.slug || strategy !== "replace") {
      throw new QuizRepositoryError(
        "QUIZ_ID_CONFLICT",
        "Идентификатор импортируемой викторины уже используется",
      );
    }
  } catch (error: unknown) {
    if (
      !(error instanceof QuizRepositoryError) ||
      error.code !== "QUIZ_NOT_FOUND"
    ) {
      throw error;
    }
  }

  const gamesDirectory = repository.getDirectory();
  const temporaryDirectory = await mkdtemp(
    join(gamesDirectory, ".quiz-import-"),
  );
  const quiz = validated.quiz;
  const stagedConfig = join(temporaryDirectory, `${quiz.slug}.json`);
  const stagedAssets = join(temporaryDirectory, "assets", quiz.slug);
  const destinationConfig = resolve(gamesDirectory, `${quiz.slug}.json`);
  const destinationAssets = resolve(gamesDirectory, "assets", quiz.slug);
  const backupConfig = join(temporaryDirectory, "backup.json");
  const backupAssets = join(temporaryDirectory, "backup-assets");
  let configBackedUp = false;
  let assetsBackedUp = false;
  let configInstalled = false;
  let assetsInstalled = false;

  try {
    await mkdir(stagedAssets, {
      recursive: true,
    });
    await writeFile(stagedConfig, `${JSON.stringify(quiz, null, 2)}\n`);
    for (const [assetPath, buffer] of validated.assets) {
      const relativeAssetPath = assetPath.slice(`assets/${quiz.slug}/`.length);
      const destination = resolve(stagedAssets, relativeAssetPath);
      if (!destination.startsWith(`${stagedAssets}/`)) {
        throw new QuizRepositoryError(
          "QUIZ_VALIDATION_ERROR",
          "Путь изображения выходит за каталог импорта",
        );
      }
      await mkdir(dirname(destination), {
        recursive: true,
      });
      await writeFile(destination, buffer, {
        flag: "wx",
      });
    }

    if (await pathExists(destinationConfig)) {
      await rename(destinationConfig, backupConfig);
      configBackedUp = true;
    }
    if (await pathExists(destinationAssets)) {
      await rename(destinationAssets, backupAssets);
      assetsBackedUp = true;
    }

    await mkdir(dirname(destinationAssets), {
      recursive: true,
    });
    await rename(stagedConfig, destinationConfig);
    configInstalled = true;
    await rename(stagedAssets, destinationAssets);
    assetsInstalled = true;
    return structuredClone(quiz);
  } catch (error: unknown) {
    if (assetsInstalled) {
      await rm(destinationAssets, {
        force: true,
        recursive: true,
      });
    }
    if (configInstalled) {
      await rm(destinationConfig, {
        force: true,
      });
    }
    if (assetsBackedUp) {
      await rename(backupAssets, destinationAssets);
    }
    if (configBackedUp) {
      await rename(backupConfig, destinationConfig);
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, {
      force: true,
      recursive: true,
    });
  }
}
