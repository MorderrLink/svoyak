import { z } from "zod";

import { QUIZ_SCHEMA_VERSION, quizLimits } from "@/shared/constants/quiz";

const entityIdSchema = z.uuid();
const orderSchema = z.number().int().nonnegative();
const timestampSchema = z.string().datetime({
  offset: true,
});

export const quizSettingsSchema = z
  .object({
    allowNegativeScore: z.boolean(),
    answerRevealSeconds: z
      .number()
      .min(quizLimits.answerRevealSeconds.min)
      .max(quizLimits.answerRevealSeconds.max),
    answerSeconds: z
      .number()
      .min(quizLimits.answerSeconds.min)
      .max(quizLimits.answerSeconds.max),
    buzzSeconds: z
      .number()
      .min(quizLimits.buzzSeconds.min)
      .max(quizLimits.buzzSeconds.max),
    questionIntroSeconds: z
      .number()
      .min(quizLimits.questionIntroSeconds.min)
      .max(quizLimits.questionIntroSeconds.max),
    showScoresToPlayers: z.boolean(),
  })
  .strict();

export const textQuestionContentSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, "Введите текст вопроса")
      .max(quizLimits.questionTextLength),
  })
  .strict();

export const quizQuestionSchema = z
  .object({
    answer: z
      .string()
      .trim()
      .min(1, "Введите правильный ответ")
      .max(quizLimits.answerLength),
    content: textQuestionContentSchema,
    hostComment: z
      .string()
      .trim()
      .min(1, "Пустой комментарий следует удалить")
      .max(quizLimits.hostCommentLength)
      .optional(),
    id: entityIdSchema,
    price: z
      .number()
      .int()
      .min(quizLimits.questionPrice.min)
      .max(quizLimits.questionPrice.max),
  })
  .strict();

export const quizThemeSchema = z
  .object({
    id: entityIdSchema,
    order: orderSchema,
    questions: z
      .array(quizQuestionSchema)
      .min(1, "Добавьте хотя бы один вопрос"),
    title: z
      .string()
      .trim()
      .min(1, "Введите название темы")
      .max(quizLimits.themeTitleLength),
  })
  .strict()
  .superRefine((theme, context) => {
    const priceIndexes = new Map<number, number>();

    theme.questions.forEach((question, questionIndex) => {
      const previousIndex = priceIndexes.get(question.price);

      if (previousIndex !== undefined) {
        context.addIssue({
          code: "custom",
          message: `Стоимость ${question.price} уже используется в этой теме`,
          path: ["questions", questionIndex, "price"],
        });
      } else {
        priceIndexes.set(question.price, questionIndex);
      }
    });
  });

export const quizRoundSchema = z
  .object({
    id: entityIdSchema,
    order: orderSchema,
    themes: z.array(quizThemeSchema).min(1, "Добавьте хотя бы одну тему"),
  })
  .strict()
  .superRefine((round, context) => {
    round.themes.forEach((theme, themeIndex) => {
      if (theme.order !== themeIndex) {
        context.addIssue({
          code: "custom",
          message: "Порядок тем должен соответствовать их позиции в массиве",
          path: ["themes", themeIndex, "order"],
        });
      }
    });
  });

export const quizConfigSchema = z
  .object({
    createdAt: timestampSchema,
    id: entityIdSchema,
    rounds: z.array(quizRoundSchema).min(1, "Добавьте хотя бы один раунд"),
    schemaVersion: z.literal(QUIZ_SCHEMA_VERSION),
    settings: quizSettingsSchema,
    slug: z
      .string()
      .min(1)
      .max(quizLimits.slugLength)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        "Slug может содержать только латиницу, цифры и одиночные дефисы",
      ),
    title: z
      .string()
      .trim()
      .min(1, "Введите название викторины")
      .max(quizLimits.titleLength),
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((quiz, context) => {
    quiz.rounds.forEach((round, roundIndex) => {
      if (round.order !== roundIndex) {
        context.addIssue({
          code: "custom",
          message:
            "Порядок раундов должен соответствовать их позиции в массиве",
          path: ["rounds", roundIndex, "order"],
        });
      }
    });

    const identifierPaths = new Map<string, Array<number | string>>();
    const registerIdentifier = (id: string, path: Array<number | string>) => {
      const previousPath = identifierPaths.get(id);

      if (previousPath !== undefined) {
        context.addIssue({
          code: "custom",
          message: `Идентификатор уже используется в ${previousPath.join(".")}`,
          path,
        });
      } else {
        identifierPaths.set(id, path);
      }
    };

    registerIdentifier(quiz.id, ["id"]);
    quiz.rounds.forEach((round, roundIndex) => {
      registerIdentifier(round.id, ["rounds", roundIndex, "id"]);

      round.themes.forEach((theme, themeIndex) => {
        registerIdentifier(theme.id, [
          "rounds",
          roundIndex,
          "themes",
          themeIndex,
          "id",
        ]);

        theme.questions.forEach((question, questionIndex) => {
          registerIdentifier(question.id, [
            "rounds",
            roundIndex,
            "themes",
            themeIndex,
            "questions",
            questionIndex,
            "id",
          ]);
        });
      });
    });

    if (Date.parse(quiz.updatedAt) < Date.parse(quiz.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt не может быть раньше createdAt",
        path: ["updatedAt"],
      });
    }
  });

export const quizSummarySchema = z
  .object({
    id: entityIdSchema,
    questionCount: z.number().int().nonnegative(),
    roundCount: z.number().int().nonnegative(),
    slug: z.string(),
    title: z.string(),
    updatedAt: timestampSchema,
  })
  .strict();
