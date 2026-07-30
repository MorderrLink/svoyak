import { PassThrough } from "node:stream";

import { ZipArchive } from "archiver";

import {
  getReferencedAssetPaths,
  type AssetStorage,
} from "@/server/media/asset-storage";
import { createPackageIntegrity } from "@/server/package/integrity";
import type { QuizConfig } from "@/shared/types/quiz";

export interface ExportedQuizPackage {
  filename: string;
  source: Buffer;
}

export async function exportQuizPackage(
  quiz: QuizConfig,
  assetStorage: AssetStorage,
): Promise<ExportedQuizPackage> {
  const assets = new Map<string, Buffer>();

  for (const path of [...getReferencedAssetPaths(quiz)].sort()) {
    assets.set(path, await assetStorage.readAsset(path));
  }

  const packagedQuiz = structuredClone(quiz);
  packagedQuiz.packageIntegrity = createPackageIntegrity(packagedQuiz, assets);

  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  const completed = new Promise<void>((resolve, reject) => {
    output.once("end", resolve);
    output.once("error", reject);
  });
  const archive = new ZipArchive({
    zlib: {
      level: 9,
    },
  });
  archive.once("error", (error: Error) => {
    output.destroy(error);
  });
  archive.pipe(output);
  archive.append(`${JSON.stringify(packagedQuiz, null, 2)}\n`, {
    name: `${quiz.slug}.json`,
  });
  archive.append("", {
    name: "assets/",
  });

  for (const [path, source] of assets) {
    archive.append(source, {
      name: path,
    });
  }

  await archive.finalize();
  await completed;

  return {
    filename: `${quiz.slug}.zip`,
    source: Buffer.concat(chunks),
  };
}
