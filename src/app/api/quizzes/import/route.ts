import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse } from "@/server/http/api-response";
import { importQuizPackage } from "@/server/package/import-package";
import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";

const importStrategySchema = z.enum(["copy", "error", "replace"]);
const maximumRequestBytes = 51 * 1_024 * 1_024;

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > maximumRequestBytes) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "ZIP-архив слишком большой",
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const strategy = importStrategySchema.parse(
      formData.get("strategy") ?? "error",
    );

    if (!(file instanceof File)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Выберите ZIP-архив",
      );
    }

    const quiz = await importQuizPackage(
      Buffer.from(await file.arrayBuffer()),
      getQuizRepository(),
      strategy,
    );
    return NextResponse.json(quiz, {
      status: 201,
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
