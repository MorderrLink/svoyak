import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";

import { ZipArchive } from "archiver";
import sharp from "sharp";
import { Open } from "unzipper";
import { afterEach, describe, expect, it } from "vitest";

import { exportQuizPackage } from "@/server/package/export-package";
import {
  assertSafeArchivePath,
  importQuizPackage,
  validateQuizPackage,
} from "@/server/package/import-package";
import {
  createPackageIntegrity,
  verifyPackageIntegrity,
} from "@/server/package/integrity";
import { QuizRepository } from "@/server/quiz/quiz-repository";
import type { QuizConfig } from "@/shared/types/quiz";

interface ArchiveEntry {
  directory?: boolean;
  path: string;
  source?: Buffer | string;
}

function createQuiz(): QuizConfig {
  return {
    createdAt: "2026-07-29T18:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000101",
    rounds: [
      {
        id: "00000000-0000-4000-8000-000000000102",
        order: 0,
        themes: [
          {
            id: "00000000-0000-4000-8000-000000000103",
            order: 0,
            questions: [
              {
                answer: "Ответ",
                content: {
                  text: "Вопрос",
                },
                id: "00000000-0000-4000-8000-000000000104",
                price: 100,
              },
            ],
            title: "Тема",
          },
        ],
      },
    ],
    schemaVersion: 1,
    settings: {
      allowNegativeScore: true,
      answerRevealSeconds: 0,
      answerSeconds: 10,
      buzzSeconds: 10,
      questionIntroSeconds: 0,
      showScoresToPlayers: true,
    },
    slug: "media-test",
    title: "Медиа-тест",
    updatedAt: "2026-07-29T18:00:00.000Z",
  };
}

async function createArchive(entries: ArchiveEntry[]): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });
  const completed = new Promise<void>((resolve, reject) => {
    output.once("end", resolve);
    output.once("error", reject);
  });
  const archive = new ZipArchive();
  archive.pipe(output);
  for (const entry of entries) {
    archive.append(entry.source ?? "", {
      name: entry.directory ? `${entry.path.replace(/\/$/, "")}/` : entry.path,
    });
  }
  await archive.finalize();
  await completed;
  return Buffer.concat(chunks);
}

async function readEntries(source: Buffer): Promise<ArchiveEntry[]> {
  const archive = await Open.buffer(source);
  return Promise.all(
    archive.files.map(async (entry) => ({
      directory: entry.type === "Directory",
      path: entry.path,
      source:
        entry.type === "Directory" ? Buffer.alloc(0) : await entry.buffer(),
    })),
  );
}

describe("пакет викторины", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          force: true,
          recursive: true,
        }),
      ),
    );
  });

  it("даёт одинаковый digest для одинакового содержимого", () => {
    const quiz = createQuiz();
    const firstAssets = new Map([
      ["assets/media-test/images/b.webp", Buffer.from("b")],
      ["assets/media-test/images/a.webp", Buffer.from("a")],
    ]);
    const secondAssets = new Map([...firstAssets].reverse());

    expect(createPackageIntegrity(quiz, firstAssets)).toEqual(
      createPackageIntegrity(quiz, secondAssets),
    );
  });

  it("отклоняет абсолютные пути, traversal и обратные слеши", () => {
    for (const path of [
      "../escape.webp",
      "/absolute.webp",
      "C:/windows.webp",
      "assets\\quiz\\image.webp",
      "assets//image.webp",
    ]) {
      expect(() => assertSafeArchivePath(path)).toThrow();
    }
    expect(() =>
      assertSafeArchivePath("assets/media-test/images/image.webp"),
    ).not.toThrow();
  });

  it("экспортирует и повторно проверяет пакет с изображением", async () => {
    const directory = await mkdtemp(join(tmpdir(), "svoyak-package-"));
    temporaryDirectories.push(directory);
    const repository = new QuizRepository(directory);
    let quiz = createQuiz();
    await repository.create(quiz);
    const png = await sharp({
      create: {
        background: "#2563eb",
        channels: 4,
        height: 12,
        width: 12,
      },
    })
      .png()
      .toBuffer();
    const image = await repository.getAssets().uploadImage(quiz.slug, png);
    const answerImage = await repository
      .getAssets()
      .uploadImage(quiz.slug, png);
    quiz = structuredClone(quiz);
    quiz.rounds[0]!.themes[0]!.questions[0]!.content.image = image;
    quiz.rounds[0]!.themes[0]!.questions[0]!.answerImage = answerImage;
    await repository.update(quiz.id, quiz);

    const exported = await exportQuizPackage(quiz, repository.getAssets());
    const validated = await validateQuizPackage(exported.source);

    expect(exported.filename).toBe("media-test.zip");
    expect(validated.quiz.packageIntegrity?.algorithm).toBe("sha256");
    expect([...validated.assets]).toHaveLength(2);
    expect(() =>
      verifyPackageIntegrity(validated.quiz, validated.assets),
    ).not.toThrow();
  });

  it("отклоняет лишний JSON и лишнюю корневую папку", async () => {
    const quiz = createQuiz();
    quiz.packageIntegrity = createPackageIntegrity(quiz, new Map());
    const config = JSON.stringify(quiz);

    await expect(
      validateQuizPackage(
        await createArchive([
          { path: "assets/", directory: true },
          { path: "media-test.json", source: config },
          { path: "extra.json", source: config },
        ]),
      ),
    ).rejects.toMatchObject({
      code: "QUIZ_VALIDATION_ERROR",
    });
    await expect(
      validateQuizPackage(
        await createArchive([
          { path: "assets/", directory: true },
          { path: "media-test.json", source: config },
          { path: "other/", directory: true },
        ]),
      ),
    ).rejects.toMatchObject({
      code: "QUIZ_VALIDATION_ERROR",
    });
  });

  it("выявляет отсутствующее и изменённое изображение", async () => {
    const directory = await mkdtemp(join(tmpdir(), "svoyak-package-"));
    temporaryDirectories.push(directory);
    const repository = new QuizRepository(directory);
    const quiz = createQuiz();
    await repository.create(quiz);
    const png = await sharp({
      create: {
        background: "#ef4444",
        channels: 4,
        height: 8,
        width: 8,
      },
    })
      .png()
      .toBuffer();
    const image = await repository.getAssets().uploadImage(quiz.slug, png);
    quiz.rounds[0]!.themes[0]!.questions[0]!.content.image = image;
    await repository.update(quiz.id, quiz);
    const exported = await exportQuizPackage(quiz, repository.getAssets());
    const entries = await readEntries(exported.source);

    await expect(
      validateQuizPackage(
        await createArchive(
          entries.filter((entry) => entry.path !== image.path),
        ),
      ),
    ).rejects.toMatchObject({
      code: "QUIZ_VALIDATION_ERROR",
    });

    const changedImage = await sharp({
      create: {
        background: "#22c55e",
        channels: 4,
        height: 8,
        width: 8,
      },
    })
      .webp()
      .toBuffer();
    await expect(
      validateQuizPackage(
        await createArchive(
          entries.map((entry) =>
            entry.path === image.path
              ? { ...entry, source: changedImage }
              : entry,
          ),
        ),
      ),
    ).rejects.toMatchObject({
      code: "QUIZ_VALIDATION_ERROR",
    });
  });

  it("выявляет изменённый конфиг и неправильный contentDigest", async () => {
    const quiz = createQuiz();
    quiz.packageIntegrity = createPackageIntegrity(quiz, new Map());
    const changed = structuredClone(quiz);
    changed.title = "Подменённое название";
    const wrongDigest = structuredClone(quiz);
    wrongDigest.packageIntegrity!.contentDigest = "0".repeat(64);

    for (const candidate of [changed, wrongDigest]) {
      await expect(
        validateQuizPackage(
          await createArchive([
            { path: "assets/", directory: true },
            {
              path: "media-test.json",
              source: JSON.stringify(candidate),
            },
          ]),
        ),
      ).rejects.toMatchObject({
        code: "QUIZ_VALIDATION_ERROR",
      });
    }
  });

  it("разрешает конфликт slug копией и очищает временный каталог", async () => {
    const directory = await mkdtemp(join(tmpdir(), "svoyak-import-"));
    temporaryDirectories.push(directory);
    const repository = new QuizRepository(directory);
    const quiz = createQuiz();
    await repository.create(quiz);
    const exported = await exportQuizPackage(quiz, repository.getAssets());

    await expect(
      importQuizPackage(exported.source, repository, "error"),
    ).rejects.toMatchObject({
      code: "QUIZ_SLUG_CONFLICT",
    });
    const copy = await importQuizPackage(exported.source, repository, "copy");

    expect(copy.slug).toBe("media-test-2");
    expect(copy.id).not.toBe(quiz.id);
    expect(await repository.list()).toHaveLength(2);
    expect(
      (await readdir(directory)).filter((entry) =>
        entry.startsWith(".quiz-import-"),
      ),
    ).toEqual([]);

    const changedExisting = {
      ...quiz,
      title: "Локально изменённая версия",
      updatedAt: "2026-07-29T19:00:00.000Z",
    };
    await repository.update(quiz.id, changedExisting);
    const replaced = await importQuizPackage(
      exported.source,
      repository,
      "replace",
    );
    expect(replaced.title).toBe("Медиа-тест");
    await expect(repository.get(quiz.id)).resolves.toMatchObject({
      title: "Медиа-тест",
    });
  });
});
