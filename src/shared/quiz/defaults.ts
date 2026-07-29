import type { QuizSettings } from "@/shared/types/quiz";

export function createDefaultQuizSettings(): QuizSettings {
  return {
    allowNegativeScore: true,
    answerRevealSeconds: 5,
    answerSeconds: 15,
    buzzSeconds: 10,
    questionIntroSeconds: 2.5,
    showScoresToPlayers: true,
  };
}
