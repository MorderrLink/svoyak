import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, readJsonBody } from "@/server/http/api-response";
import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";
import { quizLimits } from "@/shared/constants/quiz";

interface ImageRouteContext {
  params: Promise<{
    quizId: string;
  }>;
}

const deleteImageSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();
const uploadIdentitySchema = z
  .object({
    id: z.uuid(),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();

export async function POST(request: Request, context: ImageRouteContext) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > quizLimits.imageFileSize + 1_000_000) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Файл слишком большой",
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const { quizId } = await context.params;
    const identity = uploadIdentitySchema.parse({
      id: quizId,
      slug: formData.get("slug"),
    });
    const repository = getQuizRepository();
    let slug = identity.slug;

    try {
      slug = (await repository.get(quizId)).slug;
    } catch (error: unknown) {
      if (
        !(error instanceof QuizRepositoryError) ||
        error.code !== "QUIZ_NOT_FOUND"
      ) {
        throw error;
      }
      if (await repository.slugExists(slug)) {
        throw new QuizRepositoryError(
          "QUIZ_SLUG_CONFLICT",
          "Сначала выберите уникальный slug викторины",
        );
      }
    }

    if (!(file instanceof File)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Выберите файл изображения",
      );
    }

    const image = await repository
      .getAssets()
      .uploadImage(slug, Buffer.from(await file.arrayBuffer()));

    return NextResponse.json(image, {
      status: 201,
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: ImageRouteContext) {
  try {
    const { quizId } = await context.params;
    const repository = getQuizRepository();
    const quiz = await repository.get(quizId);
    const payload = deleteImageSchema.parse(await readJsonBody(request));
    await repository.getAssets().deleteImage(quiz.slug, payload.path);
    return new NextResponse(null, {
      status: 204,
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
