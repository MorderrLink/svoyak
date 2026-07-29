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

    return NextResponse.json(await repository.create(copy), {
      status: 201,
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
