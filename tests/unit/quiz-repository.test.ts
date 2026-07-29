import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});
