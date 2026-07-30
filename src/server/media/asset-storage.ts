import { randomUUID } from "node:crypto";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import {
  describeFileError,
  getFileErrorCode,
} from "@/server/file-system/file-error";
import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { quizLimits } from "@/shared/constants/quiz";
import type { QuizConfig, QuizImage } from "@/shared/types/quiz";

const allowedImageMimeTypes = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function isPathInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !pathFromParent.startsWith(sep)
  );
}

export function getReferencedAssetPaths(quiz: QuizConfig): Set<string> {
  const paths = new Set<string>();

  for (const round of quiz.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        if (question.content.image !== undefined) {
          paths.add(question.content.image.path);
        }
      }
    }
  }

  return paths;
}

export function rewriteQuizAssetPaths(
  quiz: QuizConfig,
  oldSlug: string,
  newSlug: string,
): QuizConfig {
  const copy = structuredClone(quiz);
  const oldPrefix = `assets/${oldSlug}/`;
  const newPrefix = `assets/${newSlug}/`;

  for (const round of copy.rounds) {
    for (const theme of round.themes) {
      for (const question of theme.questions) {
        const image = question.content.image;
        if (image?.path.startsWith(oldPrefix) === true) {
          image.path = `${newPrefix}${image.path.slice(oldPrefix.length)}`;
        }
      }
    }
  }

  return copy;
}

export async function validateImageSource(source: Buffer): Promise<void> {
  if (source.byteLength > quizLimits.imageFileSize) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Изображение не должно быть больше 10 МБ",
    );
  }

  const detectedType = await fileTypeFromBuffer(source);
  if (
    detectedType === undefined ||
    !allowedImageMimeTypes.has(detectedType.mime)
  ) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Поддерживаются только JPEG, PNG, WebP и GIF",
    );
  }

  try {
    const metadata = await sharp(source, {
      animated: false,
      failOn: "error",
      limitInputPixels: quizLimits.imagePixels,
    }).metadata();

    if (
      metadata.width === undefined ||
      metadata.height === undefined ||
      metadata.width * metadata.height > quizLimits.imagePixels
    ) {
      throw new Error("Слишком большое разрешение изображения");
    }
  } catch (error: unknown) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      `Не удалось проверить изображение: ${String(error)}`,
    );
  }
}

export class AssetStorage {
  private readonly assetsDirectory: string;
  private readonly gamesDirectory: string;

  constructor(gamesDirectory = resolve(process.cwd(), "games")) {
    this.gamesDirectory = resolve(gamesDirectory);
    this.assetsDirectory = resolve(this.gamesDirectory, "assets");
  }

  async uploadImage(slug: string, source: Buffer): Promise<QuizImage> {
    await validateImageSource(source);

    let normalized: Buffer;
    try {
      const image = sharp(source, {
        animated: false,
        failOn: "error",
        limitInputPixels: quizLimits.imagePixels,
      });
      normalized = await image
        .rotate()
        .webp({
          quality: 90,
        })
        .toBuffer();
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        `Не удалось проверить изображение: ${String(error)}`,
      );
    }

    const relativePath = `assets/${slug}/images/${randomUUID()}.webp`;
    const destination = this.resolveAssetPath(relativePath);
    try {
      await mkdir(dirname(destination), {
        recursive: true,
      });
      await writeFile(destination, normalized, {
        flag: "wx",
      });
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось сохранить изображение: ${describeFileError(error)}`,
      );
    }

    return {
      path: relativePath,
    };
  }

  async readAsset(assetPath: string): Promise<Buffer> {
    const path = this.resolveAssetPath(assetPath);
    try {
      return await readFile(path);
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        getFileErrorCode(error) === "ENOENT"
          ? "QUIZ_NOT_FOUND"
          : "QUIZ_STORAGE_ERROR",
        getFileErrorCode(error) === "ENOENT"
          ? "Изображение не найдено"
          : `Не удалось прочитать изображение: ${describeFileError(error)}`,
      );
    }
  }

  async deleteImage(slug: string, assetPath: string): Promise<void> {
    if (!assetPath.startsWith(`assets/${slug}/images/`)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Изображение не принадлежит викторине",
      );
    }

    try {
      await rm(this.resolveAssetPath(assetPath), {
        force: true,
      });
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось удалить изображение: ${describeFileError(error)}`,
      );
    }
  }

  async cleanupUnused(quiz: QuizConfig): Promise<void> {
    const imagesDirectory = this.getImagesDirectory(quiz.slug);
    const referenced = getReferencedAssetPaths(quiz);
    let entries: string[];

    try {
      entries = await readdir(imagesDirectory);
    } catch (error: unknown) {
      if (getFileErrorCode(error) === "ENOENT") {
        return;
      }
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось проверить каталог изображений: ${describeFileError(error)}`,
      );
    }

    try {
      await Promise.all(
        entries.map(async (entry) => {
          const assetPath = `assets/${quiz.slug}/images/${entry}`;
          if (!referenced.has(assetPath)) {
            await rm(this.resolveAssetPath(assetPath), {
              force: true,
              recursive: true,
            });
          }
        }),
      );
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось очистить изображения: ${describeFileError(error)}`,
      );
    }
  }

  async moveQuizAssets(oldSlug: string, newSlug: string): Promise<boolean> {
    if (oldSlug === newSlug) {
      return false;
    }

    const source = this.getQuizAssetsDirectory(oldSlug);
    const destination = this.getQuizAssetsDirectory(newSlug);

    try {
      await access(source);
    } catch {
      return false;
    }

    try {
      await mkdir(this.assetsDirectory, {
        recursive: true,
      });
      await rename(source, destination);
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось переместить изображения: ${describeFileError(error)}`,
      );
    }
    return true;
  }

  async copyQuizAssets(sourceSlug: string, destinationSlug: string) {
    const source = this.getQuizAssetsDirectory(sourceSlug);

    try {
      await access(source);
    } catch {
      return;
    }

    try {
      await cp(source, this.getQuizAssetsDirectory(destinationSlug), {
        errorOnExist: true,
        recursive: true,
      });
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось скопировать изображения: ${describeFileError(error)}`,
      );
    }
  }

  async deleteQuizAssets(slug: string): Promise<void> {
    try {
      await rm(this.getQuizAssetsDirectory(slug), {
        force: true,
        recursive: true,
      });
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось удалить каталог изображений: ${describeFileError(error)}`,
      );
    }
  }

  resolveAssetPath(assetPath: string): string {
    if (
      assetPath.includes("\\") ||
      assetPath.startsWith("/") ||
      assetPath.split("/").includes("..")
    ) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Недопустимый путь изображения",
      );
    }

    const resolved = resolve(this.gamesDirectory, assetPath);
    if (!isPathInside(this.assetsDirectory, resolved)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Путь изображения выходит за пределы games/assets",
      );
    }

    return resolved;
  }

  private getQuizAssetsDirectory(slug: string): string {
    const directory = resolve(this.assetsDirectory, slug);
    if (dirname(directory) !== this.assetsDirectory) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Недопустимый slug каталога assets",
      );
    }
    return directory;
  }

  private getImagesDirectory(slug: string): string {
    return resolve(this.getQuizAssetsDirectory(slug), "images");
  }
}
