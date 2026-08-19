import { NextResponse } from "next/server";

import { apiErrorResponse } from "@/server/http/api-response";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";

interface AssetRouteContext {
  params: Promise<{
    assetPath: string[];
  }>;
}

function getContentType(path: string): string {
  if (path.endsWith(".webm")) return "audio/webm";
  if (path.endsWith(".mp4")) return "video/mp4";
  return "image/webp";
}

export async function GET(request: Request, context: AssetRouteContext) {
  try {
    const { assetPath } = await context.params;
    const path = `assets/${assetPath.join("/")}`;
    const source = await getQuizRepository().getAssets().readAsset(path);

    const range = request.headers.get("range");
    const contentType = getContentType(path);
    if (range !== null) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (match !== null) {
        const start = Number(match[1]);
        const requestedEnd =
          match[2] === "" ? source.byteLength - 1 : Number(match[2]);
        const end = Math.min(requestedEnd, source.byteLength - 1);
        if (start <= end && start < source.byteLength) {
          const partial = source.subarray(start, end + 1);
          return new NextResponse(new Uint8Array(partial), {
            headers: {
              "accept-ranges": "bytes",
              "content-length": String(partial.byteLength),
              "content-range": `bytes ${start}-${end}/${source.byteLength}`,
              "content-type": contentType,
              "x-content-type-options": "nosniff",
            },
            status: 206,
          });
        }
      }
      return new NextResponse(null, {
        headers: { "content-range": `bytes */${source.byteLength}` },
        status: 416,
      });
    }

    return new NextResponse(new Uint8Array(source), {
      headers: {
        "accept-ranges": "bytes",
        "cache-control": "public, max-age=31536000, immutable",
        "content-length": String(source.byteLength),
        "content-type": contentType,
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error: unknown) {
    return apiErrorResponse(error);
  }
}
