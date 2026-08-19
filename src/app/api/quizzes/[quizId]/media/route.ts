import { NextResponse } from "next/server";
import { z } from "zod";

import { apiErrorResponse, readJsonBody } from "@/server/http/api-response";
import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";
import { quizLimits } from "@/shared/constants/quiz";

interface MediaRouteContext {
  params: Promise<{ quizId: string }>;
}

const uploadIdentitySchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(["audio", "video"]),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
const deleteMediaSchema = z.object({ path: z.string().min(1) }).strict();

export async function POST(request: Request, context: MediaRouteContext) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > quizLimits.mediaFileSize + 1_000_000) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Медиафайл слишком большой",
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    const { quizId } = await context.params;
    const identity = uploadIdentitySchema.parse({
      id: quizId,
      kind: formData.get("kind"),
      slug: formData.get("slug"),
    });
    if (!(file instanceof File)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Выберите медиафайл",
      );
    }

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

    const media = await repository
      .getAssets()
      .uploadMedia(slug, Buffer.from(await file.arrayBuffer()), identity.kind);
    return NextResponse.json(media, { status: 201 });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: MediaRouteContext) {
  try {
    const { quizId } = await context.params;
    const repository = getQuizRepository();
    const quiz = await repository.get(quizId);
    const payload = deleteMediaSchema.parse(await readJsonBody(request));
    await repository.getAssets().deleteMedia(quiz.slug, payload.path);
    return new NextResponse(null, { status: 204 });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
