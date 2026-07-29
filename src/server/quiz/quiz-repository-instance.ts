import { QuizRepository } from "@/server/quiz/quiz-repository";

const quizRepository = new QuizRepository();

export function getQuizRepository(): QuizRepository {
  return quizRepository;
}
