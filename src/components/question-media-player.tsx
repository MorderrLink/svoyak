"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/button";
import { getQuizAssetUrl } from "@/shared/api/quizzes";
import type { MediaPlaybackState } from "@/shared/contracts/socket";
import type { QuizMedia } from "@/shared/types/quiz";

export function QuestionMediaPlayer({
  media,
  playback,
}: {
  media: QuizMedia;
  playback: MediaPlaybackState | null;
}) {
  const playerRef = useRef<HTMLMediaElement | null>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const playing = playback?.playing ?? false;
  const positionMs = playback?.positionMs ?? media.trimStartMs;
  const revision = playback?.revision ?? null;
  const startedAt = playback?.startedAt ?? null;

  useEffect(() => {
    const player = playerRef.current;
    if (player === null) return;
    if (!playing) {
      player.pause();
      player.currentTime = positionMs / 1_000;
      return;
    }

    const elapsedMs =
      startedAt === null ? 0 : Math.max(0, Date.now() - startedAt);
    const synchronizedPositionMs = positionMs + elapsedMs;
    if (synchronizedPositionMs >= media.trimEndMs) {
      player.pause();
      player.currentTime = media.trimEndMs / 1_000;
      return;
    }
    player.currentTime = synchronizedPositionMs / 1_000;
    void player
      .play()
      .then(() => setAutoplayBlocked(false))
      .catch(() => setAutoplayBlocked(true));
  }, [media.trimEndMs, playing, positionMs, revision, startedAt]);

  const monitorEnd = () => {
    const player = playerRef.current;
    if (player !== null && player.currentTime >= media.trimEndMs / 1_000) {
      player.pause();
      player.currentTime = media.trimEndMs / 1_000;
    }
  };

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4 overflow-hidden">
      {media.kind === "video" ? (
        <video
          className="max-h-full min-h-0 w-full flex-1 rounded-xl bg-black object-contain"
          onTimeUpdate={monitorEnd}
          playsInline
          preload="auto"
          ref={(element) => {
            playerRef.current = element;
          }}
          src={getQuizAssetUrl(media.path)}
        />
      ) : (
        <>
          <audio
            onTimeUpdate={monitorEnd}
            preload="auto"
            ref={(element) => {
              playerRef.current = element;
            }}
            src={getQuizAssetUrl(media.path)}
          />
          <div
            aria-label="Звуковая дорожка вопроса"
            className="flex h-[clamp(8rem,24vh,16rem)] w-full max-w-5xl items-center gap-[clamp(1px,.25vw,4px)] rounded-3xl bg-slate-900/80 px-[clamp(1rem,3vw,3rem)] shadow-2xl"
            role="img"
          >
            {media.waveform.map((peak, index) => (
              <span
                className={[
                  "min-w-0 flex-1 rounded-full transition-colors duration-200",
                  playback?.playing === true ? "bg-blue-400" : "bg-slate-500",
                ].join(" ")}
                key={index}
                style={{ height: `${Math.max(7, peak * 88)}%` }}
              />
            ))}
          </div>
        </>
      )}
      {autoplayBlocked && playing ? (
        <Button
          className="absolute inset-x-auto bottom-4 shadow-xl"
          onClick={() => {
            void playerRef.current
              ?.play()
              .then(() => setAutoplayBlocked(false));
          }}
        >
          Включить звук
        </Button>
      ) : null}
    </div>
  );
}
