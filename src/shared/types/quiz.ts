import type {
  assetChecksumSchema,
  packageIntegritySchema,
  questionContentSchema,
  quizConfigSchema,
  quizImageSchema,
  quizMediaSchema,
  quizQuestionSchema,
  quizRoundSchema,
  quizSettingsSchema,
  quizThemeSchema,
  textQuestionContentSchema,
} from "@/shared/schemas/quiz";

import type { z } from "zod";

export type QuizConfig = z.infer<typeof quizConfigSchema>;
export type AssetChecksum = z.infer<typeof assetChecksumSchema>;
export type PackageIntegrity = z.infer<typeof packageIntegritySchema>;
export type QuestionContent = z.infer<typeof questionContentSchema>;
export type QuizImage = z.infer<typeof quizImageSchema>;
export type QuizMedia = z.infer<typeof quizMediaSchema>;
export type QuizQuestion = z.infer<typeof quizQuestionSchema>;
export type QuizRound = z.infer<typeof quizRoundSchema>;
export type QuizSettings = z.infer<typeof quizSettingsSchema>;
export type QuizTheme = z.infer<typeof quizThemeSchema>;
export type TextQuestionContent = z.infer<typeof textQuestionContentSchema>;

export interface QuizSummary {
  id: string;
  questionCount: number;
  roundCount: number;
  slug: string;
  title: string;
  updatedAt: string;
}
