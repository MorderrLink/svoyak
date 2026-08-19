"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { getQuizAssetUrl } from "@/shared/api/quizzes";
import { DEFAULT_IMAGE_ALT_TEXT } from "@/shared/constants/quiz";
import type { QuizImage, QuizMedia } from "@/shared/types/quiz";

const imageAccept =
  ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif";

function formatTime(milliseconds: number): string {
  const seconds = milliseconds / 1_000;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

export function QuestionMediaEditor({
  image,
  media,
  onChange,
  onImageAltChange,
  onRemove,
  onUpload,
  onUploadImage,
  questionNumber,
  uploading,
}: {
  image: QuizImage | undefined;
  media: QuizMedia | undefined;
  onChange: (media: QuizMedia) => void;
  onImageAltChange: (alt: string) => void;
  onRemove: () => void;
  onUpload: (file: File, kind: "audio" | "video") => void;
  onUploadImage: (file: File) => void;
  questionNumber: number;
  uploading: boolean;
}) {
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const playerRef = useRef<HTMLMediaElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const minimumClipMs = Math.min(250, media?.durationMs ?? 250);

  const openFilePicker = (input: HTMLInputElement | null) => {
    if (input === null) return;
    input.value = "";
    input.click();
  };

  const previewFromStart = async () => {
    const player = playerRef.current;
    if (player === null || media === undefined) return;
    player.currentTime = media.trimStartMs / 1_000;
    await player.play();
  };

  const togglePreviewPlayback = async () => {
    const player = playerRef.current;
    if (player === null || media === undefined) return;
    if (!player.paused) {
      player.pause();
      return;
    }
    if (player.currentTime >= media.trimEndMs / 1_000) {
      player.currentTime = media.trimStartMs / 1_000;
    }
    await player.play();
  };

  const monitorTrimEnd = () => {
    const player = playerRef.current;
    if (
      player !== null &&
      media !== undefined &&
      player.currentTime >= media.trimEndMs / 1_000
    ) {
      player.pause();
      player.currentTime = media.trimEndMs / 1_000;
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-slate-600 bg-slate-800/70 p-4 lg:col-span-2 lg:col-start-2">
      <h5 className="font-bold">Медиа</h5>
      {image === undefined && media === undefined ? (
        <div className="grid w-full grid-cols-3 gap-3">
          <input
            accept={imageAccept}
            aria-label={`Изображение вопроса ${questionNumber}`}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onUploadImage(file);
            }}
            ref={imageInputRef}
            type="file"
          />
          <input
            accept="audio/*,video/mp4,video/webm,video/quicktime"
            aria-label={`Аудио вопроса ${questionNumber}`}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onUpload(file, "audio");
            }}
            ref={audioInputRef}
            type="file"
          />
          <input
            accept="video/mp4,video/webm,video/quicktime"
            aria-label={`Видео вопроса ${questionNumber}`}
            className="sr-only"
            disabled={uploading}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file !== undefined) onUpload(file, "video");
            }}
            ref={videoInputRef}
            type="file"
          />
          <Button
            className="w-full"
            disabled={uploading}
            onClick={() => openFilePicker(imageInputRef.current)}
            variant="surface"
          >
            Изображение
          </Button>
          <Button
            className="w-full"
            disabled={uploading}
            onClick={() => openFilePicker(audioInputRef.current)}
            variant="surface"
          >
            Аудио
          </Button>
          <Button
            className="w-full"
            disabled={uploading}
            onClick={() => openFilePicker(videoInputRef.current)}
            variant="surface"
          >
            Видео
          </Button>
        </div>
      ) : image !== undefined ? (
        <div className="grid gap-3 rounded-lg bg-slate-800 p-3 sm:grid-cols-[12rem_1fr]">
          <Image
            alt={image.alt ?? "Предпросмотр вопроса"}
            className="h-36 w-full rounded-lg object-contain"
            height={144}
            src={getQuizAssetUrl(image.path)}
            unoptimized
            width={192}
          />
          <div>
            <label>
              <span className="mb-1 block text-sm text-slate-300">
                Alt-текст
              </span>
              <Input
                aria-label={`Alt-текст вопроса ${questionNumber}`}
                onChange={(event) => onImageAltChange(event.target.value)}
                value={image.alt ?? DEFAULT_IMAGE_ALT_TEXT}
              />
            </label>
            <Button className="mt-3" onClick={onRemove} variant="danger">
              Удалить изображение
            </Button>
          </div>
        </div>
      ) : media !== undefined ? (
        <div className="space-y-4">
          {media.kind === "audio" ? (
            <div
              aria-label="Звуковая дорожка"
              className="relative flex h-28 items-center gap-[2px] overflow-hidden rounded-xl bg-slate-950 px-3"
              role="img"
            >
              {media.waveform.map((peak, index) => {
                const position = index / Math.max(1, media.waveform.length - 1);
                const selected =
                  position >= media.trimStartMs / media.durationMs &&
                  position <= media.trimEndMs / media.durationMs;
                return (
                  <span
                    className={[
                      "min-w-0 flex-1 rounded-full transition-colors",
                      selected ? "bg-blue-400" : "bg-slate-700",
                    ].join(" ")}
                    key={index}
                    style={{ height: `${Math.max(8, peak * 88)}%` }}
                  />
                );
              })}
            </div>
          ) : (
            <video
              className="max-h-72 w-full rounded-xl bg-black object-contain"
              onPause={() => setPreviewPlaying(false)}
              onPlay={() => setPreviewPlaying(true)}
              onTimeUpdate={monitorTrimEnd}
              playsInline
              preload="metadata"
              ref={(element) => {
                playerRef.current = element;
              }}
              src={getQuizAssetUrl(media.path)}
            />
          )}

          {media.kind === "audio" ? (
            <audio
              onPause={() => setPreviewPlaying(false)}
              onPlay={() => setPreviewPlaying(true)}
              onTimeUpdate={monitorTrimEnd}
              preload="metadata"
              ref={(element) => {
                playerRef.current = element;
              }}
              src={getQuizAssetUrl(media.path)}
            />
          ) : null}

          <div className="relative h-8">
            <input
              aria-label={`Начало обрезки вопроса ${questionNumber}`}
              className="pointer-events-none absolute inset-0 w-full accent-blue-400 [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto"
              max={media.durationMs}
              min={0}
              onChange={(event) => {
                onChange({
                  ...media,
                  trimStartMs: Math.min(
                    Number(event.target.value),
                    media.trimEndMs - minimumClipMs,
                  ),
                });
              }}
              step={100}
              type="range"
              value={media.trimStartMs}
            />
            <input
              aria-label={`Конец обрезки вопроса ${questionNumber}`}
              className="pointer-events-none absolute inset-0 w-full accent-amber-400 [&::-moz-range-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:pointer-events-auto"
              max={media.durationMs}
              min={0}
              onChange={(event) => {
                onChange({
                  ...media,
                  trimEndMs: Math.max(
                    Number(event.target.value),
                    media.trimStartMs + minimumClipMs,
                  ),
                });
              }}
              step={100}
              type="range"
              value={media.trimEndMs}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              {formatTime(media.trimStartMs)} — {formatTime(media.trimEndMs)} ·{" "}
              {formatTime(media.trimEndMs - media.trimStartMs)}
            </span>
            <div className="flex gap-2">
              <Button
                onClick={() => void previewFromStart()}
                variant="secondary"
              >
                ▶ Предпросмотр
              </Button>
              <Button
                onClick={() => void togglePreviewPlayback()}
                variant="secondary"
              >
                {previewPlaying ? "⏸ Пауза" : "▶ Продолжить"}
              </Button>
              <Button onClick={onRemove} variant="danger">
                Удалить {media.kind === "audio" ? "аудио" : "видео"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
