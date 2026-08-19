import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ffmpegPathValue from "ffmpeg-static";
import ffprobe from "ffprobe-static";
import { fileTypeFromBuffer } from "file-type";
import { z } from "zod";

import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { quizLimits } from "@/shared/constants/quiz";
import type { QuizMedia } from "@/shared/types/quiz";

const allowedAudioMimeTypes = new Set([
  "audio/flac",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);
const allowedVideoMimeTypes = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-matroska",
]);
const probeSchema = z
  .object({
    format: z.object({ duration: z.coerce.number().positive() }).passthrough(),
    streams: z.array(
      z.object({ codec_type: z.enum(["audio", "video"]) }).passthrough(),
    ),
  })
  .passthrough();

interface ProcessResult {
  stderr: Buffer;
  stdout: Buffer;
}

export interface ProcessedMedia {
  durationMs: number;
  extension: ".mp4" | ".webm";
  kind: QuizMedia["kind"];
  mimeType: QuizMedia["mimeType"];
  source: Buffer;
  waveform?: number[];
}

function requireFfmpegPath(): string {
  if (ffmpegPathValue === null) {
    throw new QuizRepositoryError(
      "QUIZ_STORAGE_ERROR",
      "FFmpeg недоступен на этой платформе",
    );
  }
  return ffmpegPathValue;
}

function runProcess(
  executable: string,
  arguments_: string[],
  maximumOutputBytes = 2 * 1_024 * 1_024,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, arguments_, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new Error("Обработка медиа превысила лимит времени"));
      }
    }, 120_000);

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maximumOutputBytes) {
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (
        stderr.reduce((total, entry) => total + entry.byteLength, 0) < 2_000_000
      ) {
        stderr.push(chunk);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (outputBytes > maximumOutputBytes) {
        reject(new Error("Вывод медиапроцесса слишком велик"));
      } else if (code !== 0) {
        reject(new Error(Buffer.concat(stderr).toString("utf8").slice(-2_000)));
      } else {
        resolve({
          stderr: Buffer.concat(stderr),
          stdout: Buffer.concat(stdout),
        });
      }
    });
  });
}

async function probe(path: string) {
  const result = await runProcess(ffprobe.path, [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    path,
  ]);
  return probeSchema.parse(
    JSON.parse(result.stdout.toString("utf8")) as unknown,
  );
}

function createWaveform(pcm: Buffer): number[] {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  const peaks = Array.from(
    { length: quizLimits.mediaWaveformSamples },
    (_, binIndex) => {
      const start = Math.floor(
        (binIndex * sampleCount) / quizLimits.mediaWaveformSamples,
      );
      const end = Math.max(
        start + 1,
        Math.floor(
          ((binIndex + 1) * sampleCount) / quizLimits.mediaWaveformSamples,
        ),
      );
      let peak = 0;
      for (let index = start; index < end && index < sampleCount; index += 1) {
        peak = Math.max(peak, Math.abs(pcm.readInt16LE(index * 2)) / 32_768);
      }
      return peak;
    },
  );
  const maximum = Math.max(0.001, ...peaks);
  return peaks.map((peak) => Math.round((peak / maximum) * 1_000) / 1_000);
}

export async function processMediaUpload(
  source: Buffer,
  target: "audio" | "video",
): Promise<ProcessedMedia> {
  if (source.byteLength > quizLimits.mediaFileSize) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Медиафайл не должен быть больше 200 МБ",
    );
  }

  const detectedType = await fileTypeFromBuffer(source);
  const sourceIsAudio =
    detectedType !== undefined && allowedAudioMimeTypes.has(detectedType.mime);
  const sourceIsVideo =
    detectedType !== undefined && allowedVideoMimeTypes.has(detectedType.mime);
  if (
    (target === "audio" && !sourceIsAudio && !sourceIsVideo) ||
    (target === "video" && !sourceIsVideo)
  ) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      target === "audio"
        ? "Выберите поддерживаемый аудио- или видеофайл"
        : "Выберите поддерживаемый видеофайл",
    );
  }

  const directory = await mkdtemp(join(tmpdir(), "svoyak-media-"));
  const inputPath = join(
    directory,
    `input${detectedType?.ext ? `.${detectedType.ext}` : ""}`,
  );
  const extension = target === "audio" ? ".webm" : ".mp4";
  const outputPath = join(directory, `output${extension}`);

  try {
    await writeFile(inputPath, source);
    const inputProbe = await probe(inputPath);
    if (!inputProbe.streams.some((stream) => stream.codec_type === target)) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        target === "audio"
          ? "В файле нет звуковой дорожки"
          : "В файле нет видео",
      );
    }
    if (inputProbe.format.duration * 1_000 > quizLimits.mediaDurationMs) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Медиафайл не должен быть длиннее 30 минут",
      );
    }

    const ffmpegArguments =
      target === "audio"
        ? [
            "-y",
            "-i",
            inputPath,
            "-map",
            "0:a:0",
            "-vn",
            "-c:a",
            "libopus",
            "-b:a",
            "128k",
            "-ar",
            "48000",
            "-ac",
            "2",
            outputPath,
          ]
        : [
            "-y",
            "-i",
            inputPath,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            outputPath,
          ];
    await runProcess(requireFfmpegPath(), ffmpegArguments);
    const normalized = await readFile(outputPath);
    if (normalized.byteLength > quizLimits.mediaFileSize) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Нормализованный медиафайл превышает 200 МБ",
      );
    }
    const outputProbe = await probe(outputPath);
    const durationMs = Math.max(
      1,
      Math.round(outputProbe.format.duration * 1_000),
    );
    let waveform: number[] | undefined;
    if (target === "audio") {
      const pcm = await runProcess(
        requireFfmpegPath(),
        [
          "-i",
          outputPath,
          "-map",
          "0:a:0",
          "-ac",
          "1",
          "-ar",
          "8000",
          "-f",
          "s16le",
          "pipe:1",
        ],
        32 * 1_024 * 1_024,
      );
      waveform = createWaveform(pcm.stdout);
    }

    return {
      durationMs,
      extension,
      kind: target,
      mimeType: target === "audio" ? "audio/webm" : "video/mp4",
      source: normalized,
      ...(waveform === undefined ? {} : { waveform }),
    };
  } catch (error: unknown) {
    if (error instanceof QuizRepositoryError) throw error;
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      `Не удалось обработать медиафайл: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function validateMediaAsset(
  source: Buffer,
  media: QuizMedia,
): Promise<void> {
  if (source.byteLength > quizLimits.mediaFileSize) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Медиафайл в архиве превышает допустимый размер",
    );
  }
  const detected = await fileTypeFromBuffer(source);
  const expectedMime = media.kind === "audio" ? "audio/webm" : "video/mp4";
  if (detected?.mime !== expectedMime) {
    throw new QuizRepositoryError(
      "QUIZ_VALIDATION_ERROR",
      "Формат медиафайла не соответствует конфигу",
    );
  }
  const directory = await mkdtemp(join(tmpdir(), "svoyak-media-check-"));
  const path = join(
    directory,
    media.kind === "audio" ? "asset.webm" : "asset.mp4",
  );
  try {
    await writeFile(path, source);
    const result = await probe(path);
    if (
      !result.streams.some((stream) => stream.codec_type === media.kind) ||
      result.format.duration * 1_000 > quizLimits.mediaDurationMs
    ) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Медиафайл в архиве не прошёл проверку",
      );
    }
    if (Math.abs(result.format.duration * 1_000 - media.durationMs) > 250) {
      throw new QuizRepositoryError(
        "QUIZ_VALIDATION_ERROR",
        "Длительность медиафайла не совпадает с конфигом",
      );
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}
