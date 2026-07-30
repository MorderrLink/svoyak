export const QUIZ_SCHEMA_VERSION = 1 as const;

export const quizLimits = {
  answerLength: 2_000,
  answerRevealSeconds: {
    max: 120,
    min: 0,
  },
  answerSeconds: {
    max: 300,
    min: 1,
  },
  buzzSeconds: {
    max: 300,
    min: 1,
  },
  hostCommentLength: 5_000,
  imageAltLength: 500,
  imageFileSize: 10 * 1_024 * 1_024,
  imagePixels: 40_000_000,
  questionIntroSeconds: {
    max: 30,
    min: 0,
  },
  questionPrice: {
    max: 1_000_000,
    min: 1,
  },
  questionTextLength: 5_000,
  slugLength: 100,
  themeTitleLength: 120,
  titleLength: 120,
} as const;
