import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/server/http/api-response";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";

interface QuizRouteContext {
  params: Promise<{
    quizId: string;
  }>;
}

export async function GET(_request: Request, context: QuizRouteContext) {
  try {
    const { quizId } = await context.params;
    return NextResponse.json(await getQuizRepository().get(quizId));
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request, context: QuizRouteContext) {
  try {
    const { quizId } = await context.params;
    const quiz = await getQuizRepository().update(
      quizId,
      await readJsonBody(request),
    );
    return NextResponse.json(quiz);
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: QuizRouteContext) {
  try {
    const { quizId } = await context.params;
    await getQuizRepository().delete(quizId);
    return new NextResponse(null, {
      status: 204,
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
