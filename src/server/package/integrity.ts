import { createHash } from "node:crypto";

import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import type {
  AssetChecksum,
  PackageIntegrity,
  QuizConfig,
} from "@/shared/types/quiz";

type JsonValue =
  | JsonValue[]
  | boolean
  | null
  | number
  | string
  | {
      [key: string]: JsonValue;
    };

function normalizeJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }

  throw new QuizRepositoryError(
    "QUIZ_VALIDATION_ERROR",
    "Конфиг содержит неканонизируемое значение",
  );
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function sha256(source: Buffer | string): string {
  return createHash("sha256").update(source).digest("hex");
}

export function createAssetChecksums(
  assets: ReadonlyMap<string, Buffer>,
): AssetChecksum[] {
  return [...assets.entries()]
    .map(([path, source]) => ({
      path,
      sha256: sha256(source),
      size: source.byteLength,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function createContentDigest(
  quiz: QuizConfig,
  assets: AssetChecksum[],
): string {
  const config = structuredClone(quiz);
  config.packageIntegrity = {
    algorithm: "sha256",
    assets,
    contentDigest: "0".repeat(64),
  };

  const digestConfig = structuredClone(config) as QuizConfig;
  if (digestConfig.packageIntegrity !== undefined) {
    digestConfig.packageIntegrity.contentDigest = "";
  }

  const assetIndex = assets
    .map((asset) => `${asset.path}\0${asset.size}\0${asset.sha256}`)
    .join("\n");
  return sha256(`${canonicalizeJson(digestConfig)}\n${assetIndex}`);
}

export function createPackageIntegrity(
  quiz: QuizConfig,
  assetSources: ReadonlyMap<string, Buffer>,
): PackageIntegrity {
  const assets = createAssetChecksums(assetSources);
  return {
    algorithm: "sha256",
    assets,
    contentDigest: createContentDigest(quiz, assets),
  };
}

export function verifyPackageIntegrity(
  quiz: QuizConfig,
  assetSources: ReadonlyMap<string, Buffer>,
): void {
  const integrity = quiz.packageIntegrity;
  if (integrity === undefined) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "В архиве отсутствует манифест целостности",
    );
  }

  const actual = createPackageIntegrity(quiz, assetSources);
  if (canonicalizeJson(integrity.assets) !== canonicalizeJson(actual.assets)) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Размер или SHA-256 файлов архива не совпадает с манифестом",
    );
  }

  if (integrity.contentDigest !== actual.contentDigest) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Нарушен contentDigest викторины",
    );
  }
}
