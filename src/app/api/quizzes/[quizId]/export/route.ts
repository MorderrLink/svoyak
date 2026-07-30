import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/server/http/api-response";
import { exportQuizPackage } from "@/server/package/export-package";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";

interface ExportRouteContext {
  params: Promise<{
    quizId: string;
  }>;
}

export async function GET(_request: Request, context: ExportRouteContext) {
  try {
    const { quizId } = await context.params;
    const repository = getQuizRepository();
    const quiz = await repository.get(quizId);
    const exported = await exportQuizPackage(quiz, repository.getAssets());

    return new NextResponse(new Uint8Array(exported.source), {
      headers: {
        "content-disposition": `attachment; filename="${exported.filename}"`,
        "content-length": String(exported.source.byteLength),
        "content-type": "application/zip",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
