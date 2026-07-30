import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/server/http/api-response";
import { createUniqueCopy } from "@/server/quiz/duplicate-quiz";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";

interface DuplicateQuizRouteContext {
  params: Promise<{
    quizId: string;
  }>;
}

export async function POST(
  _request: Request,
  context: DuplicateQuizRouteContext,
) {
  try {
    const { quizId } = await context.params;
    const repository = getQuizRepository();
    const source = await repository.get(quizId);
    const copy = await createUniqueCopy(source, (slug) =>
      repository.slugExists(slug),
    );

    const created = await repository.create(copy);
    try {
      await repository.getAssets().copyQuizAssets(source.slug, copy.slug);
      return NextResponse.json(created, {
        status: 201,
      });
    } catch (error: unknown) {
      await repository.delete(created.id);
      throw error;
    }
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
