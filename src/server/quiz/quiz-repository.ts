import { randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import {
  describeFileError,
  getFileErrorCode,
} from "@/server/file-system/file-error";
import { AssetStorage } from "@/server/media/asset-storage";
import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { quizConfigSchema } from "@/shared/schemas/quiz";
import type { QuizConfig, QuizSummary } from "@/shared/types/quiz";

interface StoredQuiz {
  path: string;
  quiz: QuizConfig;
}

export class QuizRepository {
  private readonly assetStorage: AssetStorage;
  private readonly gamesDirectory: string;

  constructor(gamesDirectory = resolve(process.cwd(), "games")) {
    this.gamesDirectory = resolve(gamesDirectory);
    this.assetStorage = new AssetStorage(this.gamesDirectory);
  }

  getAssets(): AssetStorage {
    return this.assetStorage;
  }

  getDirectory(): string {
    return this.gamesDirectory;
  }

  async list(): Promise<QuizSummary[]> {
    const quizzes = await this.readAll();

    return quizzes
      .map(({ quiz }) => ({
        id: quiz.id,
        questionCount: quiz.rounds.reduce(
          (roundTotal, round) =>
            roundTotal +
            round.themes.reduce(
              (themeTotal, theme) => themeTotal + theme.questions.length,
              0,
            ),
          0,
        ),
        roundCount: quiz.rounds.length,
        slug: quiz.slug,
        title: quiz.title,
        updatedAt: quiz.updatedAt,
      }))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async get(quizId: string): Promise<QuizConfig> {
    const stored = await this.findById(quizId);

    if (stored === undefined) {
      throw new QuizRepositoryError("QUIZ_NOT_FOUND", "Викторина не найдена");
    }

    return structuredClone(stored.quiz);
  }

  async create(input: unknown): Promise<QuizConfig> {
    const quiz = this.parseQuiz(input);

    if ((await this.findById(quiz.id)) !== undefined) {
      throw new QuizRepositoryError(
        "QUIZ_ID_CONFLICT",
        "Викторина с таким идентификатором уже существует",
      );
    }

    if (await this.slugExists(quiz.slug)) {
      throw new QuizRepositoryError(
        "QUIZ_SLUG_CONFLICT",
        "Викторина с таким slug уже существует",
      );
    }

    await this.atomicWrite(this.getConfigPath(quiz.slug), quiz);
    await this.assetStorage.cleanupUnused(quiz);
    return structuredClone(quiz);
  }

  async update(quizId: string, input: unknown): Promise<QuizConfig> {
    const quiz = this.parseQuiz(input);
    const stored = await this.findById(quizId);

    if (stored === undefined) {
      throw new QuizRepositoryError("QUIZ_NOT_FOUND", "Викторина не найдена");
    }

    if (quiz.id !== quizId) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Идентификатор викторины нельзя изменить",
      );
    }

    const destinationPath = this.getConfigPath(quiz.slug);
    if (destinationPath !== stored.path && (await this.slugExists(quiz.slug))) {
      throw new QuizRepositoryError(
        "QUIZ_SLUG_CONFLICT",
        "Викторина с таким slug уже существует",
      );
    }

    const slugChanged = destinationPath !== stored.path;
    let assetsMoved = false;

    if (slugChanged) {
      assetsMoved = await this.assetStorage.moveQuizAssets(
        stored.quiz.slug,
        quiz.slug,
      );
    }

    try {
      await this.atomicWrite(destinationPath, quiz);

      if (slugChanged) {
        await unlink(stored.path);
      }
    } catch (error: unknown) {
      try {
        if (slugChanged) {
          await rm(destinationPath, {
            force: true,
          });
        }
        if (assetsMoved) {
          await this.assetStorage.moveQuizAssets(quiz.slug, stored.quiz.slug);
        }
      } catch (rollbackError: unknown) {
        console.error(
          "Не удалось откатить обновление викторины:",
          rollbackError,
        );
      }
      throw error;
    }

    await this.assetStorage.cleanupUnused(quiz);
    return structuredClone(quiz);
  }

  async delete(quizId: string): Promise<void> {
    const stored = await this.findById(quizId);

    if (stored === undefined) {
      throw new QuizRepositoryError("QUIZ_NOT_FOUND", "Викторина не найдена");
    }

    try {
      await unlink(stored.path);
      await this.assetStorage.deleteQuizAssets(stored.quiz.slug);
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось удалить викторину: ${describeFileError(error)}`,
      );
    }
  }

  async findBySlug(slug: string): Promise<QuizConfig | undefined> {
    const stored = (await this.readAll()).find(
      ({ quiz }) => quiz.slug === slug,
    );
    return stored === undefined ? undefined : structuredClone(stored.quiz);
  }

  async slugExists(slug: string): Promise<boolean> {
    const path = this.getConfigPath(slug);

    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await mkdir(this.gamesDirectory, {
        recursive: true,
      });
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Каталог games недоступен: ${describeFileError(error)}`,
      );
    }
  }

  private getConfigPath(slug: string): string {
    const path = resolve(this.gamesDirectory, `${slug}.json`);

    if (dirname(path) !== this.gamesDirectory) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        "Недопустимый путь к конфигу",
      );
    }

    return path;
  }

  private parseQuiz(input: unknown): QuizConfig {
    const result = quizConfigSchema.safeParse(input);

    if (!result.success) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        result.error.issues[0]?.message ?? "Некорректный конфиг викторины",
      );
    }

    return result.data;
  }

  private async readAll(): Promise<StoredQuiz[]> {
    await this.ensureDirectory();
    const entries = await readdir(this.gamesDirectory, {
      withFileTypes: true,
    });
    const quizzes: StoredQuiz[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name) !== ".json") {
        continue;
      }

      const path = resolve(this.gamesDirectory, entry.name);
      if (dirname(path) !== this.gamesDirectory) {
        continue;
      }

      try {
        const source = await readFile(path, "utf8");
        let json: unknown;
        try {
          json = JSON.parse(source) as unknown;
        } catch {
          throw new QuizRepositoryError(
            "QUIZ_STORAGE_ERROR",
            `Файл ${entry.name} содержит повреждённый JSON`,
          );
        }
        const parsed = quizConfigSchema.safeParse(json);
        if (!parsed.success) {
          throw new QuizRepositoryError(
            "QUIZ_STORAGE_ERROR",
            `Файл ${entry.name} повреждён: ${parsed.error.issues[0]?.message ?? "некорректный формат"}`,
          );
        }
        quizzes.push({
          path,
          quiz: parsed.data,
        });
      } catch (error: unknown) {
        if (error instanceof QuizRepositoryError) {
          throw error;
        }

        throw new QuizRepositoryError(
          "QUIZ_STORAGE_ERROR",
          `Не удалось прочитать ${entry.name}: ${describeFileError(error)}`,
        );
      }
    }

    return quizzes;
  }

  private async findById(quizId: string): Promise<StoredQuiz | undefined> {
    return (await this.readAll()).find(({ quiz }) => quiz.id === quizId);
  }

  private async atomicWrite(path: string, quiz: QuizConfig): Promise<void> {
    await this.ensureDirectory();
    const temporaryPath = resolve(
      this.gamesDirectory,
      `.${quiz.slug}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(temporaryPath, `${JSON.stringify(quiz, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporaryPath, path);
    } catch (error: unknown) {
      throw new QuizRepositoryError(
        "QUIZ_STORAGE_ERROR",
        `Не удалось сохранить викторину: ${describeFileError(error)}`,
      );
    } finally {
      try {
        await rm(temporaryPath, {
          force: true,
        });
      } catch (cleanupError: unknown) {
        if (getFileErrorCode(cleanupError) !== "ENOENT") {
          console.warn(
            `Не удалось очистить временный файл викторины: ${describeFileError(cleanupError)}`,
          );
        }
      }
    }
  }
}
