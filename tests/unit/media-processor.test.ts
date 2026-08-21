import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ffmpegPath from "ffmpeg-static";
import { describe, expect, it } from "vitest";

import { processMediaUpload } from "@/server/media/media-processor";
import { quizLimits } from "@/shared/constants/quiz";

const execute = promisify(execFile);

describe("обработка медиа", () => {
  it("извлекает звуковую дорожку из видео и строит waveform", async () => {
    if (ffmpegPath === null) throw new Error("FFmpeg недоступен");
    const directory = await mkdtemp(join(tmpdir(), "svoyak-media-test-"));
    const videoPath = join(directory, "source.mp4");
    try {
      await execute(ffmpegPath, [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=160x90:d=0.6",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=0.6",
        "-shortest",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        videoPath,
      ]);

      const source = await readFile(videoPath);
      const result = await processMediaUpload(source, "audio");
      expect(result).toMatchObject({
        extension: ".webm",
        kind: "audio",
        mimeType: "audio/webm",
      });
      expect(result.durationMs).toBeGreaterThan(400);
      expect(result.waveform).toHaveLength(quizLimits.mediaWaveformSamples);
      expect(result.source.byteLength).toBeGreaterThan(100);

      const video = await processMediaUpload(source, "video");
      expect(video).toMatchObject({
        extension: ".mp4",
        kind: "video",
        mimeType: "video/mp4",
      });
      expect(video.durationMs).toBeGreaterThan(400);
      expect(video.source.byteLength).toBeGreaterThan(100);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  }, 30_000);
});
