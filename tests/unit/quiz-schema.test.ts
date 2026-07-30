import { describe, expect, it } from "vitest";

import { createDefaultQuizSettings } from "@/shared/quiz/defaults";
import { quizConfigSchema } from "@/shared/schemas/quiz";
import type { QuizConfig, QuizQuestion } from "@/shared/types/quiz";

function createValidQuiz(): QuizConfig {
  return {
    createdAt: "2026-07-29T18:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000001",
    rounds: [
      {
        id: "00000000-0000-4000-8000-000000000002",
        order: 0,
        themes: [
          {
            id: "00000000-0000-4000-8000-000000000003",
            order: 0,
            questions: [
              {
                answer: "Киану Ривз",
                content: {
                  text: "Назовите актёра.",
                },
                hostComment: "Можно принять только имя и фамилию",
                id: "00000000-0000-4000-8000-000000000004",
                price: 100,
              },
            ],
            title: "Кино",
          },
        ],
      },
    ],
    schemaVersion: 1,
    settings: createDefaultQuizSettings(),
    slug: "kino-2026",
    title: "Кино 2026",
    updatedAt: "2026-07-29T18:01:00.000Z",
  };
}

function getFirstQuestion(quiz: QuizConfig): QuizQuestion {
  const question = quiz.rounds[0]?.themes[0]?.questions[0];

  if (question === undefined) {
    throw new Error("В тестовой викторине отсутствует вопрос");
  }

  return question;
}

describe("quizConfigSchema", () => {
  it("принимает корректную текстовую викторину версии 1", () => {
    expect(quizConfigSchema.safeParse(createValidQuiz()).success).toBe(true);
  });

  it("отклоняет неизвестную версию схемы", () => {
    const quiz = {
      ...createValidQuiz(),
      schemaVersion: 2,
    };

    expect(quizConfigSchema.safeParse(quiz).success).toBe(false);
  });

  it("не допускает названия раунда в сохраняемом конфиге", () => {
    const quiz = createValidQuiz();
    const round = quiz.rounds[0];

    if (round === undefined) {
      throw new Error("В тестовой викторине отсутствует раунд");
    }

    const candidate = {
      ...quiz,
      rounds: [
        {
          ...round,
          title: "Финал",
        },
      ],
    };

    expect(quizConfigSchema.safeParse(candidate).success).toBe(false);
  });

  it("требует непустой текст и правильный ответ", () => {
    const quiz = createValidQuiz();
    const question = getFirstQuestion(quiz);
    question.content.text = "   ";
    question.answer = "";

    expect(quizConfigSchema.safeParse(quiz).success).toBe(false);
  });

  it("поддерживает вопрос только с изображением", () => {
    const quiz = createValidQuiz();
    const question = getFirstQuestion(quiz);
    question.content = {
      image: {
        alt: "Кадр из фильма",
        path: "assets/kino-2026/images/frame.webp",
      },
    };

    expect(quizConfigSchema.safeParse(quiz).success).toBe(true);
  });

  it("отклоняет путь изображения другого slug", () => {
    const quiz = createValidQuiz();
    getFirstQuestion(quiz).content.image = {
      path: "assets/other-quiz/images/frame.webp",
    };

    expect(quizConfigSchema.safeParse(quiz).success).toBe(false);
  });

  it("запрещает одинаковую стоимость вопросов внутри темы", () => {
    const quiz = createValidQuiz();
    const questions = quiz.rounds[0]?.themes[0]?.questions;

    if (questions === undefined) {
      throw new Error("В тестовой викторине отсутствует тема");
    }

    questions.push({
      answer: "Ответ",
      content: {
        text: "Второй вопрос",
      },
      id: "00000000-0000-4000-8000-000000000005",
      price: 100,
    });

    expect(quizConfigSchema.safeParse(quiz).success).toBe(false);
  });

  it("разрешает одинаковую стоимость в разных темах", () => {
    const quiz = createValidQuiz();
    const round = quiz.rounds[0];

    if (round === undefined) {
      throw new Error("В тестовой викторине отсутствует раунд");
    }

    round.themes.push({
      id: "00000000-0000-4000-8000-000000000005",
      order: 1,
      questions: [
        {
          answer: "Ответ",
          content: {
            text: "Вопрос другой темы",
          },
          id: "00000000-0000-4000-8000-000000000006",
          price: 100,
        },
      ],
      title: "Музыка",
    });

    expect(quizConfigSchema.safeParse(quiz).success).toBe(true);
  });

  it("требует уникальные идентификаторы всех сущностей", () => {
    const quiz = createValidQuiz();
    getFirstQuestion(quiz).id = quiz.id;

    expect(quizConfigSchema.safeParse(quiz).success).toBe(false);
  });

  it("требует соответствия order позиции в массиве", () => {
    const quiz = createValidQuiz();
    const round = quiz.rounds[0];

    if (round === undefined) {
      throw new Error("В тестовой викторине отсутствует раунд");
    }

    round.order = 1;

    expect(quizConfigSchema.safeParse(quiz).success).toBe(false);
  });

  it("не допускает updatedAt раньше createdAt", () => {
    const quiz = createValidQuiz();
    quiz.updatedAt = "2026-07-29T17:59:59.000Z";

    expect(quizConfigSchema.safeParse(quiz).success).toBe(false);
  });
});
