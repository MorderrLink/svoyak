import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { QuizRepository } from "@/server/quiz/quiz-repository";
import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { createDefaultQuizSettings } from "@/shared/quiz/defaults";
import type { QuizConfig } from "@/shared/types/quiz";

function createQuiz(overrides: Partial<QuizConfig> = {}): QuizConfig {
  return {
    createdAt: "2026-07-29T18:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000011",
    rounds: [
      {
        id: "00000000-0000-4000-8000-000000000012",
        order: 0,
        themes: [
          {
            id: "00000000-0000-4000-8000-000000000013",
            order: 0,
            questions: [
              {
                answer: "Ответ",
                content: {
                  text: "Вопрос",
                },
                id: "00000000-0000-4000-8000-000000000014",
                price: 100,
              },
            ],
            title: "Тема",
          },
        ],
      },
    ],
    schemaVersion: 1,
    settings: createDefaultQuizSettings(),
    slug: "test-quiz",
    title: "Тестовая викторина",
    updatedAt: "2026-07-29T18:00:00.000Z",
    ...overrides,
  };
}

describe("QuizRepository", () => {
  let directory: string;
  let repository: QuizRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "svoyak-quiz-repository-"));
    repository = new QuizRepository(directory);
  });

  afterEach(async () => {
    await rm(directory, {
      force: true,
      recursive: true,
    });
  });

  it("создаёт, читает и перечисляет викторины", async () => {
    const quiz = createQuiz();

    await repository.create(quiz);

    await expect(repository.get(quiz.id)).resolves.toEqual(quiz);
    await expect(repository.list()).resolves.toEqual([
      {
        id: quiz.id,
        questionCount: 1,
        roundCount: 1,
        slug: quiz.slug,
        title: quiz.title,
        updatedAt: quiz.updatedAt,
      },
    ]);
  });

  it("атомарно обновляет и переименовывает конфиг по slug", async () => {
    const quiz = createQuiz();
    await repository.create(quiz);

    const updated = {
      ...quiz,
      slug: "renamed-quiz",
      title: "Новое название",
      updatedAt: "2026-07-29T19:00:00.000Z",
    };
    await repository.update(quiz.id, updated);

    await expect(repository.get(quiz.id)).resolves.toEqual(updated);
    await expect(readdir(directory)).resolves.toEqual(["renamed-quiz.json"]);
  });

  it("удаляет викторину", async () => {
    const quiz = createQuiz();
    await repository.create(quiz);
    await repository.delete(quiz.id);

    await expect(repository.list()).resolves.toEqual([]);
    await expect(repository.get(quiz.id)).rejects.toMatchObject({
      code: "QUIZ_NOT_FOUND",
    });
  });

  it("не допускает конфликт slug", async () => {
    const quiz = createQuiz();
    await repository.create(quiz);

    await expect(
      repository.create({
        ...quiz,
        id: "00000000-0000-4000-8000-000000000021",
      }),
    ).rejects.toMatchObject({
      code: "QUIZ_SLUG_CONFLICT",
    });
  });

  it("не записывает конфиг с небезопасным slug", async () => {
    await expect(
      repository.create({
        ...createQuiz(),
        slug: "../outside",
      }),
    ).rejects.toBeInstanceOf(QuizRepositoryError);
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("переносит изображения при смене slug и удаляет вместе с викториной", async () => {
    let quiz = createQuiz();
    await repository.create(quiz);
    const png = await sharp({
      create: {
        background: "#000000",
        channels: 4,
        height: 4,
        width: 4,
      },
    })
      .png()
      .toBuffer();
    const image = await repository.getAssets().uploadImage(quiz.slug, png);
    quiz.rounds[0]!.themes[0]!.questions[0]!.content.image = image;
    await repository.update(quiz.id, quiz);

    quiz = {
      ...quiz,
      rounds: quiz.rounds.map((round) => ({
        ...round,
        themes: round.themes.map((theme) => ({
          ...theme,
          questions: theme.questions.map((question) => ({
            ...question,
            content: {
              ...question.content,
              image:
                question.content.image === undefined
                  ? undefined
                  : {
                      ...question.content.image,
                      path: question.content.image.path.replace(
                        "assets/test-quiz/",
                        "assets/renamed-quiz/",
                      ),
                    },
            },
          })),
        })),
      })),
      slug: "renamed-quiz",
      updatedAt: "2026-07-29T19:00:00.000Z",
    };
    const updated = await repository.update(quiz.id, quiz);
    const updatedPath =
      updated.rounds[0]!.themes[0]!.questions[0]!.content.image!.path;

    await expect(
      repository.getAssets().readAsset(updatedPath),
    ).resolves.toBeInstanceOf(Buffer);
    await repository.delete(quiz.id);
    await expect(
      repository.getAssets().readAsset(updatedPath),
    ).rejects.toMatchObject({
      code: "QUIZ_NOT_FOUND",
    });
  });

  it("не разрешает чтение assets вне games", async () => {
    await expect(
      repository.getAssets().readAsset("../secret.webp"),
    ).rejects.toMatchObject({
      code: "QUIZ_VALIDATION_ERROR",
    });
  });

  it("возвращает понятную ошибку для повреждённого JSON", async () => {
    await writeFile(join(directory, "broken.json"), "{broken", "utf8");

    await expect(repository.list()).rejects.toMatchObject({
      code: "QUIZ_STORAGE_ERROR",
      message: "Файл broken.json содержит повреждённый JSON",
    });
  });
});
