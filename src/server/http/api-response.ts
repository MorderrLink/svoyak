import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import type { ApiErrorResponse } from "@/shared/types/api";

function getStatus(error: QuizRepositoryError): number {
  switch (error.code) {
    case "QUIZ_NOT_FOUND":
      return 404;
    case "QUIZ_ID_CONFLICT":
    case "QUIZ_SLUG_CONFLICT":
      return 409;
    case "QUIZ_VALIDATION_ERROR":
      return 400;
    case "QUIZ_STORAGE_ERROR":
      return 500;
  }
}

export function apiErrorResponse(
  error: unknown,
): NextResponse<ApiErrorResponse> {
  if (error instanceof QuizRepositoryError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      {
        status: getStatus(error),
      },
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "QUIZ_VALIDATION_ERROR",
          message: error.issues[0]?.message ?? "Некорректные данные",
        },
      },
      {
        status: 400,
      },
    );
  }

  console.error("Необработанная ошибка API:", error);
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Внутренняя ошибка сервера",
      },
    },
    {
      status: 500,
    },
  );
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Тело запроса должно содержать JSON",
    );
  }
}
