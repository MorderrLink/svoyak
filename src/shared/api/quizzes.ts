import { quizConfigSchema, quizSummarySchema } from "@/shared/schemas/quiz";
import type { QuizConfig, QuizSummary } from "@/shared/types/quiz";

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("Сервер вернул некорректный ответ");
  }
}

async function throwApiError(response: Response): Promise<never> {
  const body = await readResponseJson(response);
  const message =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "message" in body.error &&
    typeof body.error.message === "string"
      ? body.error.message
      : `Ошибка запроса (${response.status})`;

  throw new Error(message);
}

async function requestQuiz(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<QuizConfig> {
  const response = await fetch(input, init);

  if (!response.ok) {
    return throwApiError(response);
  }

  return quizConfigSchema.parse(await readResponseJson(response));
}

export async function listQuizzes(): Promise<QuizSummary[]> {
  const response = await fetch("/api/quizzes", {
    cache: "no-store",
  });

  if (!response.ok) {
    return throwApiError(response);
  }

  return quizSummarySchema.array().parse(await readResponseJson(response));
}

export function getQuiz(quizId: string): Promise<QuizConfig> {
  return requestQuiz(`/api/quizzes/${encodeURIComponent(quizId)}`, {
    cache: "no-store",
  });
}

export function createQuiz(quiz: QuizConfig): Promise<QuizConfig> {
  return requestQuiz("/api/quizzes", {
    body: JSON.stringify(quiz),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}

export function updateQuiz(quiz: QuizConfig): Promise<QuizConfig> {
  return requestQuiz(`/api/quizzes/${encodeURIComponent(quiz.id)}`, {
    body: JSON.stringify(quiz),
    headers: {
      "content-type": "application/json",
    },
    method: "PUT",
  });
}

export function duplicateQuiz(quizId: string): Promise<QuizConfig> {
  return requestQuiz(`/api/quizzes/${encodeURIComponent(quizId)}/duplicate`, {
    method: "POST",
  });
}

export async function deleteQuiz(quizId: string): Promise<void> {
  const response = await fetch(`/api/quizzes/${encodeURIComponent(quizId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    return throwApiError(response);
  }
}
