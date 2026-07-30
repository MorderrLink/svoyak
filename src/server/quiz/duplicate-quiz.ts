import { randomUUID } from "node:crypto";

import { rewriteQuizAssetPaths } from "@/server/media/asset-storage";
import type { QuizConfig } from "@/shared/types/quiz";

export async function createUniqueCopy(
  source: QuizConfig,
  slugExists: (slug: string) => Promise<boolean>,
): Promise<QuizConfig> {
  let suffix = 2;
  let slug = `${source.slug}-copy`;

  while (await slugExists(slug)) {
    slug = `${source.slug}-${suffix}`;
    suffix += 1;
  }

  const timestamp = new Date().toISOString();

  const copy: QuizConfig = {
    ...structuredClone(source),
    createdAt: timestamp,
    id: randomUUID(),
    rounds: source.rounds.map((round) => ({
      ...structuredClone(round),
      id: randomUUID(),
      themes: round.themes.map((theme) => ({
        ...structuredClone(theme),
        id: randomUUID(),
        questions: theme.questions.map((question) => ({
          ...structuredClone(question),
          id: randomUUID(),
        })),
      })),
    })),
    slug,
    title: `${source.title} — копия`,
    updatedAt: timestamp,
  };

  delete copy.packageIntegrity;
  return rewriteQuizAssetPaths(copy, source.slug, slug);
}
