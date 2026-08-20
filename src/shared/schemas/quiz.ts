import { z } from "zod";

import { QUIZ_SCHEMA_VERSION, quizLimits } from "@/shared/constants/quiz";

const entityIdSchema = z.uuid();
const orderSchema = z.number().int().nonnegative();
const timestampSchema = z.string().datetime({
  offset: true,
});
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const assetChecksumSchema = z
  .object({
    path: z.string().min(1),
    sha256: sha256Schema,
    size: z.number().int().nonnegative(),
  })
  .strict();

export const packageIntegritySchema = z
  .object({
    algorithm: z.literal("sha256"),
    assets: z.array(assetChecksumSchema),
    contentDigest: sha256Schema,
  })
  .strict();

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

export const quizImageSchema = z
  .object({
    alt: z.string().trim().max(quizLimits.imageAltLength).optional(),
    path: z
      .string()
      .trim()
      .regex(
        /^assets\/[a-z0-9]+(?:-[a-z0-9]+)*\/images\/[a-zA-Z0-9._-]+$/,
        "Некорректный путь изображения",
      ),
  })
  .strict();

const quizMediaBaseSchema = z.object({
  durationMs: z.number().int().positive().max(quizLimits.mediaDurationMs),
  path: z
    .string()
    .trim()
    .regex(
      /^assets\/[a-z0-9]+(?:-[a-z0-9]+)*\/media\/[a-zA-Z0-9._-]+$/,
      "Некорректный путь медиафайла",
    ),
  trimEndMs: z.number().int().positive().max(quizLimits.mediaDurationMs),
  trimStartMs: z.number().int().nonnegative().max(quizLimits.mediaDurationMs),
});

export const quizAudioSchema = quizMediaBaseSchema
  .extend({
    kind: z.literal("audio"),
    mimeType: z.literal("audio/webm"),
    waveform: z
      .array(z.number().min(0).max(1))
      .length(quizLimits.mediaWaveformSamples),
  })
  .strict()
  .superRefine((media, context) => {
    if (!media.path.endsWith(".webm")) {
      context.addIssue({
        code: "custom",
        message: "Аудио должно иметь расширение .webm",
        path: ["path"],
      });
    }
    if (
      media.trimStartMs >= media.trimEndMs ||
      media.trimEndMs > media.durationMs
    ) {
      context.addIssue({
        code: "custom",
        message: "Некорректные границы обрезки аудио",
        path: ["trimEndMs"],
      });
    }
  });

export const quizVideoSchema = quizMediaBaseSchema
  .extend({
    kind: z.literal("video"),
    mimeType: z.literal("video/mp4"),
  })
  .strict()
  .superRefine((media, context) => {
    if (!media.path.endsWith(".mp4")) {
      context.addIssue({
        code: "custom",
        message: "Видео должно иметь расширение .mp4",
        path: ["path"],
      });
    }
    if (
      media.trimStartMs >= media.trimEndMs ||
      media.trimEndMs > media.durationMs
    ) {
      context.addIssue({
        code: "custom",
        message: "Некорректные границы обрезки видео",
        path: ["trimEndMs"],
      });
    }
  });

export const quizMediaSchema = z.discriminatedUnion("kind", [
  quizAudioSchema,
  quizVideoSchema,
]);

export const questionContentSchema = z
  .object({
    image: quizImageSchema.optional(),
    media: quizMediaSchema.optional(),
    text: z.string().trim().max(quizLimits.questionTextLength).optional(),
  })
  .strict()
  .superRefine((content, context) => {
    if (
      (content.text?.length ?? 0) === 0 &&
      content.image === undefined &&
      content.media === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "Добавьте текст, изображение, аудио или видео вопроса",
        path: ["text"],
      });
    }
    if (content.image !== undefined && content.media !== undefined) {
      context.addIssue({
        code: "custom",
        message: "Вопрос может содержать только один тип медиа",
        path: ["media"],
      });
    }
  });

export const textQuestionContentSchema = questionContentSchema;

const wagerLimitSchema = z
  .number()
  .int()
  .min(quizLimits.wager.min)
  .max(quizLimits.wager.max)
  .refine(
    (value) => value % quizLimits.wager.step === 0,
    `Максимальная ставка должна быть кратна ${quizLimits.wager.step}`,
  );

export const quizQuestionSchema = z
  .object({
    answer: z.string().trim().max(quizLimits.answerLength),
    answerImage: quizImageSchema.optional(),
    content: questionContentSchema,
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
    wagerLimit: wagerLimitSchema.optional(),
  })
  .strict()
  .superRefine((question, context) => {
    if (question.answer.length === 0 && question.answerImage === undefined) {
      context.addIssue({
        code: "custom",
        message: "Добавьте текст или изображение правильного ответа",
        path: ["answer"],
      });
    }
  });

const specialModifierBaseSchema = z.object({
  id: entityIdSchema,
  text: z
    .string()
    .trim()
    .min(1, "Введите текст модификатора")
    .max(quizLimits.specialModifierTextLength),
});

export const quizSpecialModifierSchema = z.discriminatedUnion("kind", [
  specialModifierBaseSchema
    .extend({
      kind: z.literal("giveaway"),
    })
    .strict(),
  specialModifierBaseSchema
    .extend({
      delta: z
        .number()
        .int()
        .min(-quizLimits.questionPrice.max)
        .max(quizLimits.questionPrice.max),
      kind: z.literal("money"),
    })
    .strict(),
  specialModifierBaseSchema
    .extend({
      kind: z.literal("invert-score"),
    })
    .strict(),
  specialModifierBaseSchema
    .extend({
      kind: z.literal("mercy"),
    })
    .strict(),
]);

export const quizThemeSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, "Пустое пояснение следует удалить")
      .max(quizLimits.themeDescriptionLength)
      .optional(),
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
  .strict();

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
    packageIntegrity: packageIntegritySchema.optional(),
    rounds: z.array(quizRoundSchema).min(1, "Добавьте хотя бы один раунд"),
    schemaVersion: z.literal(QUIZ_SCHEMA_VERSION),
    settings: quizSettingsSchema,
    specialModifiers: z.array(quizSpecialModifierSchema).optional(),
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
    quiz.specialModifiers?.forEach((modifier, modifierIndex) => {
      registerIdentifier(modifier.id, [
        "specialModifiers",
        modifierIndex,
        "id",
      ]);
    });
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

    quiz.rounds.forEach((round, roundIndex) => {
      round.themes.forEach((theme, themeIndex) => {
        theme.questions.forEach((question, questionIndex) => {
          for (const [fieldPath, imagePath] of [
            [["content", "image"], question.content.image?.path],
            [["answerImage"], question.answerImage?.path],
          ] as const) {
            if (
              imagePath !== undefined &&
              !imagePath.startsWith(`assets/${quiz.slug}/images/`)
            ) {
              context.addIssue({
                code: "custom",
                message: "Путь изображения не соответствует slug викторины",
                path: [
                  "rounds",
                  roundIndex,
                  "themes",
                  themeIndex,
                  "questions",
                  questionIndex,
                  ...fieldPath,
                  "path",
                ],
              });
            }
          }

          const mediaPath = question.content.media?.path;
          if (
            mediaPath !== undefined &&
            !mediaPath.startsWith(`assets/${quiz.slug}/media/`)
          ) {
            context.addIssue({
              code: "custom",
              message: "Путь медиафайла не соответствует slug викторины",
              path: [
                "rounds",
                roundIndex,
                "themes",
                themeIndex,
                "questions",
                questionIndex,
                "content",
                "media",
                "path",
              ],
            });
          }
        });
      });
    });
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
