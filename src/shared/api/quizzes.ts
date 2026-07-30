import {
  quizConfigSchema,
  quizImageSchema,
  quizSummarySchema,
} from "@/shared/schemas/quiz";
import type { QuizConfig, QuizImage, QuizSummary } from "@/shared/types/quiz";

export class QuizApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "QuizApiError";
  }
}

async function readResponseJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error("Сервер вернул некорректный ответ");
  }
}

async function throwApiError(response: Response): Promise<never> {
  const body = await readResponseJson(response);
  const code =
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "object" &&
    body.error !== null &&
    "code" in body.error &&
    typeof body.error.code === "string"
      ? body.error.code
      : "INTERNAL_ERROR";
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

  throw new QuizApiError(message, code, response.status);
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

export async function uploadQuizImage(
  quizId: string,
  slug: string,
  file: File,
): Promise<QuizImage> {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("slug", slug);
  const response = await fetch(
    `/api/quizzes/${encodeURIComponent(quizId)}/images`,
    {
      body: formData,
      method: "POST",
    },
  );

  if (!response.ok) {
    return throwApiError(response);
  }

  return quizImageSchema.parse(await readResponseJson(response));
}

export async function deleteQuizImage(
  quizId: string,
  path: string,
): Promise<void> {
  const response = await fetch(
    `/api/quizzes/${encodeURIComponent(quizId)}/images`,
    {
      body: JSON.stringify({
        path,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "DELETE",
    },
  );

  if (!response.ok) {
    return throwApiError(response);
  }
}

export function getQuizAssetUrl(path: string): string {
  return `/api/${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

export async function downloadQuizPackage(
  quizId: string,
): Promise<{ filename: string; source: Blob }> {
  const response = await fetch(
    `/api/quizzes/${encodeURIComponent(quizId)}/export`,
  );
  if (!response.ok) {
    return throwApiError(response);
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const filename =
    /filename="([^"]+)"/.exec(disposition)?.[1] ?? "quiz-package.zip";
  return {
    filename,
    source: await response.blob(),
  };
}

export async function importQuizPackage(
  file: File,
  strategy: "copy" | "error" | "replace" = "error",
): Promise<QuizConfig> {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("strategy", strategy);
  return requestQuiz("/api/quizzes/import", {
    body: formData,
    method: "POST",
  });
}
