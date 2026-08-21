import slugify from "slugify";

import { QUIZ_SCHEMA_VERSION } from "@/shared/constants/quiz";
import { createDefaultQuizSettings } from "@/shared/quiz/defaults";
import type {
  QuizConfig,
  QuizQuestion,
  QuizRound,
  QuizSpecialModifier,
  QuizTheme,
} from "@/shared/types/quiz";
import { createUuid } from "@/shared/utils/create-uuid";

export function createQuizSlug(title: string): string {
  return (
    slugify(title, {
      locale: "ru",
      lower: true,
      strict: true,
      trim: true,
    }) || "quiz"
  );
}

export function createQuestion(price = 100): QuizQuestion {
  return {
    answer: "",
    content: {
      text: "",
    },
    id: createUuid(),
    price,
  };
}

export function createTheme(order: number): QuizTheme {
  return {
    id: createUuid(),
    order,
    questions: [createQuestion()],
    title: `Тема ${order + 1}`,
  };
}

export function createRound(order: number): QuizRound {
  return {
    id: createUuid(),
    order,
    themes: [createTheme(0)],
  };
}

export function createSpecialModifier(
  kind: QuizSpecialModifier["kind"],
): QuizSpecialModifier {
  const base = {
    id: createUuid(),
    text:
      kind === "giveaway"
        ? "Отдай вопрос"
        : kind === "money"
          ? "Держи косарь!"
          : kind === "invert-score"
            ? "Плюс на минус"
            : "Проси милостыню",
  };

  return kind === "money" ? { ...base, delta: 1_000, kind } : { ...base, kind };
}

export function createNewQuiz(): QuizConfig {
  const timestamp = new Date().toISOString();
  const title = "Новая викторина";

  return {
    createdAt: timestamp,
    id: createUuid(),
    rounds: [createRound(0)],
    schemaVersion: QUIZ_SCHEMA_VERSION,
    settings: createDefaultQuizSettings(),
    specialModifiers: [],
    slug: createQuizSlug(title),
    title,
    updatedAt: timestamp,
  };
}
