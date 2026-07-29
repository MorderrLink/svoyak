export type QuizRepositoryErrorCode =
  | "QUIZ_ID_CONFLICT"
  | "QUIZ_NOT_FOUND"
  | "QUIZ_SLUG_CONFLICT"
  | "QUIZ_STORAGE_ERROR"
  | "QUIZ_VALIDATION_ERROR";

export class QuizRepositoryError extends Error {
  readonly code: QuizRepositoryErrorCode;

  constructor(code: QuizRepositoryErrorCode, message: string) {
    super(message);
    this.name = "QuizRepositoryError";
    this.code = code;
  }
}
