import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/server/http/api-response";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";

interface AssetRouteContext {
  params: Promise<{
    assetPath: string[];
  }>;
}

export async function GET(_request: Request, context: AssetRouteContext) {
  try {
    const { assetPath } = await context.params;
    const path = `assets/${assetPath.join("/")}`;
    const source = await getQuizRepository().getAssets().readAsset(path);

    return new NextResponse(new Uint8Array(source), {
      headers: {
        "cache-control": "public, max-age=31536000, immutable",
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
