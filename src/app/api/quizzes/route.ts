import { NextResponse } from "next/server";

import { apiErrorResponse, readJsonBody } from "@/server/http/api-response";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";

export async function GET() {
  try {
    return NextResponse.json(await getQuizRepository().list());
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const quiz = await getQuizRepository().create(await readJsonBody(request));
    return NextResponse.json(quiz, {
      status: 201,
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
