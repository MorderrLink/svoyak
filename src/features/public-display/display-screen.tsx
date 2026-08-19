"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";

import { BottomProgress } from "@/components/bottom-progress";
import { ErrorMessage } from "@/components/error-message";
import { QuestionMediaPlayer } from "@/components/question-media-player";
import { getQuizAssetUrl } from "@/shared/api/quizzes";
import type {
  DisplayGameState,
  DisplayRoomState,
} from "@/shared/contracts/socket";
import { createClientSocket } from "@/shared/socket/client";
import type { ApplicationClientSocket } from "@/shared/socket/client";
import type { QuizImage } from "@/shared/types/quiz";

export interface DisplayScreenProps {
  roomCode: string;
}

export function DisplayScreen({ roomCode }: DisplayScreenProps) {
  const router = useRouter();
  const socketRef = useRef<ApplicationClientSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [state, setState] = useState<DisplayRoomState | null>(null);

  useEffect(() => {
    const socket = createClientSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
      socket.emit("room:attach-display", { roomCode }, (result) => {
        if (!result.ok) {
          if (result.error.code === "ROOM_NOT_FOUND") {
            router.replace("/");
            return;
          }
          setError(result.error.message);
        }
      });
    });
    socket.on("disconnect", () => {
      setConnected(false);
    });
    socket.on("display:state", setState);
    socket.on("error", (socketError) => {
      if (socketError.code === "ROOM_NOT_FOUND") {
        router.replace("/");
        return;
      }
      setError(socketError.message);
    });
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, router]);

  const joinUrl = useMemo(
    () =>
      typeof window === "undefined"
        ? ""
        : `${window.location.origin}/join/${roomCode}`,
    [roomCode],
  );

  useEffect(() => {
    if (joinUrl === "") return;
    let active = true;
    void QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 260,
    }).then((source) => {
      if (active) setQrCode(source);
    });
    return () => {
      active = false;
    };
  }, [joinUrl]);

  if (error !== null && state === null) {
    return (
      <main className="grid h-full place-items-center bg-slate-950 p-6 text-white">
        <ErrorMessage>{error}</ErrorMessage>
      </main>
    );
  }

  return (
    <main className="relative flex h-full flex-col overflow-hidden bg-slate-950 p-[clamp(1rem,2vw,2rem)] text-white">
      <header className="flex shrink-0 items-center justify-between gap-4">
        <h1 className="text-[clamp(1.25rem,2.5vw,2.25rem)] font-black text-blue-300">
          {state?.quizTitle ?? "Свояк"}
        </h1>
        <span
          aria-label={connected ? "Онлайн" : "Оффлайн"}
          className={[
            "size-4 shrink-0 rounded-full ring-2 ring-slate-900",
            connected ? "bg-emerald-400" : "bg-red-500",
          ].join(" ")}
          role="status"
        />
      </header>

      <div
        className="min-h-0 flex-1"
        data-testid={`display-phase-${state?.game?.phase ?? "lobby"}`}
      >
        <DisplayContent qrCode={qrCode} state={state} />
      </div>

      <BottomProgress timer={state?.game?.timer ?? null} />
    </main>
  );
}

function DisplayContent({
  qrCode,
  state,
}: {
  qrCode: string | null;
  state: DisplayRoomState | null;
}) {
  if (state === null || state.game === null) {
    return (
      <section className="grid h-full place-items-center">
        <div className="grid items-center gap-[clamp(1.5rem,4vw,4rem)] text-center md:grid-cols-[1fr_auto]">
          <div>
            <p className="text-[clamp(1rem,2vw,1.5rem)] text-blue-300">
              Подключайтесь к игре
            </p>
            <p className="mt-5 text-[clamp(1rem,2vw,1.75rem)] text-slate-300">
              Игроков подключено: {state?.connectedPlayerCount ?? 0}
            </p>
          </div>
          {qrCode === null ? null : (
            <Image
              alt="QR-код подключения игроков"
              className="mx-auto h-[min(32vh,16rem)] w-[min(32vh,16rem)] rounded-xl bg-white p-2"
              height={260}
              priority
              src={qrCode}
              unoptimized
              width={260}
            />
          )}
        </div>
      </section>
    );
  }

  const game = state.game;

  if (game.phase === "board") {
    return <DisplayBoard game={game} />;
  }

  if (
    game.phase === "theme-explanation" &&
    game.activeThemeExplanation !== null
  ) {
    return (
      <section className="grid h-full min-h-0 place-items-center overflow-hidden py-[clamp(1rem,3vh,3rem)] text-center">
        <div className="max-h-full max-w-[92vw] overflow-hidden">
          <p className="text-[clamp(1rem,2vw,1.75rem)] font-semibold text-blue-300">
            Пояснение темы
          </p>
          <h1 className="mt-2 text-[clamp(2rem,5vw,5rem)] leading-tight font-black text-balance">
            {game.activeThemeExplanation.title}
          </h1>
          <p className="mt-[clamp(1rem,3vh,2.5rem)] text-[clamp(1.2rem,3vw,3rem)] leading-snug font-semibold text-balance [overflow-wrap:anywhere] whitespace-pre-line">
            {game.activeThemeExplanation.description}
          </p>
        </div>
      </section>
    );
  }

  if (game.phase === "game-finished") {
    return (
      <section className="grid h-full place-items-center text-center">
        <div>
          <p className="text-[clamp(1rem,2vw,1.5rem)] text-blue-300">
            Игра завершена
          </p>
          <h1 className="mt-2 text-[clamp(2.5rem,7vw,6rem)] font-black">
            Спасибо за игру!
          </h1>
        </div>
      </section>
    );
  }

  const question = game.activeQuestion;
  if (question === null) return null;

  if (game.phase === "question-intro") {
    return (
      <section className="grid h-full place-items-center text-center">
        <div>
          <h1 className="max-w-[90vw] text-[clamp(2rem,8vw,7rem)] leading-tight font-black text-balance">
            {question.themeTitle}
          </h1>
          <p className="mt-6 text-[clamp(3rem,10vw,9rem)] font-black text-blue-300">
            {question.price}
          </p>
        </div>
      </section>
    );
  }

  if (game.phase === "answer-reveal") {
    return (
      <section className="flex h-full min-h-0 py-[clamp(1rem,2vh,2rem)]">
        <DisplayMediaContent
          image={question.answerImage}
          prominent
          text={question.answer}
        />
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-0 flex-col py-[clamp(1rem,2vh,2rem)]">
      <p className="shrink-0 text-center text-[clamp(.9rem,1.5vw,1.25rem)] text-blue-300">
        {question.themeTitle} · {question.price}
      </p>
      {question.media === null ? (
        <DisplayMediaContent image={question.image} text={question.text} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[clamp(.75rem,2vh,1.5rem)] py-2">
          {question.text === null ? null : (
            <h2 className="shrink-0 text-center text-[clamp(1.25rem,3vw,3.5rem)] leading-tight font-bold text-balance [overflow-wrap:anywhere] whitespace-pre-line">
              {question.text}
            </h2>
          )}
          <QuestionMediaPlayer
            media={question.media}
            playback={game.mediaPlayback}
          />
        </div>
      )}

      {question.currentPlayerName === null ? null : (
        <p className="shrink-0 text-center text-[clamp(1.25rem,3vw,2.5rem)] font-semibold text-amber-300">
          Отвечает {question.currentPlayerName}
        </p>
      )}
    </section>
  );
}

function DisplayMediaContent({
  image,
  prominent = false,
  text,
}: {
  image: QuizImage | null;
  prominent?: boolean;
  text: string | null;
}) {
  const hasText = text !== null && text !== "";
  const hasImage = image !== null;
  const textLength = text?.length ?? 0;
  const explicitLineCount = text?.split(/\r\n|\r|\n/).length ?? 0;
  const textSizeClass =
    textLength > 500 || explicitLineCount > 8
      ? "text-[clamp(1rem,2.1vw,2rem)] leading-[1.12]"
      : textLength > 300 || explicitLineCount > 6
        ? "text-[clamp(1.1rem,2.6vw,2.75rem)] leading-[1.15]"
        : textLength > 180 || explicitLineCount > 4
          ? "text-[clamp(1.25rem,3.2vw,3.5rem)] leading-[1.18]"
          : hasImage && explicitLineCount > 2
            ? "text-[clamp(1.25rem,3vw,3.25rem)] leading-[1.15]"
            : prominent
              ? "text-[clamp(2.5rem,7vw,7rem)] leading-tight"
              : "text-[clamp(1.75rem,4.5vw,5rem)] leading-tight";

  return (
    <div
      className={[
        "h-full min-h-0 flex-1 gap-[clamp(.75rem,2vh,1.5rem)]",
        hasText && hasImage
          ? "flex flex-col"
          : "grid h-full place-items-center",
      ].join(" ")}
      data-testid="display-media-content"
    >
      {hasText ? (
        <h2
          className={[
            "max-h-full shrink-0 overflow-hidden font-bold text-balance [overflow-wrap:anywhere] whitespace-pre-line",
            hasImage ? "max-h-[48%] text-center" : "max-w-full",
            textSizeClass,
          ].join(" ")}
          data-testid="display-media-text"
        >
          {text}
        </h2>
      ) : null}
      {image === null ? null : (
        <div
          className={[
            "relative min-h-0 w-full overflow-hidden",
            hasText ? "flex-1" : "h-full",
          ].join(" ")}
        >
          <Image
            alt={
              image.alt ??
              (prominent ? "Изображение ответа" : "Изображение вопроса")
            }
            className="rounded-xl object-contain"
            data-testid="display-media-image"
            fill
            priority
            sizes="100vw"
            src={getQuizAssetUrl(image.path)}
            unoptimized
          />
        </div>
      )}
    </div>
  );
}

function DisplayBoard({ game }: { game: DisplayGameState }) {
  const maxQuestionCount = Math.max(
    1,
    ...game.board.map((theme) => theme.questions.length),
  );

  return (
    <section className="grid h-full min-h-0 py-4">
      <div
        className="grid min-h-0 gap-[clamp(.3rem,.8vw,.75rem)]"
        style={{
          gridTemplateColumns: `minmax(8rem, 1.4fr) repeat(${maxQuestionCount}, minmax(3rem, 1fr))`,
          gridTemplateRows: `repeat(${Math.max(1, game.board.length)}, minmax(0, 1fr))`,
        }}
      >
        {game.board.map((theme) => (
          <div className="contents" key={theme.id}>
            <h2 className="grid min-h-0 place-items-center overflow-hidden rounded-lg bg-slate-800 p-2 text-center text-[clamp(.75rem,1.7vw,1.5rem)] leading-tight font-bold text-balance">
              {theme.title}
            </h2>
            {Array.from({ length: maxQuestionCount }, (_, questionIndex) => {
              const question = theme.questions[questionIndex];

              return question === undefined ? (
                <div
                  aria-hidden
                  className="min-h-0 rounded-lg bg-slate-900/30"
                  key={`${theme.id}-empty-${questionIndex}`}
                />
              ) : (
                <div
                  className={[
                    "grid min-h-0 place-items-center rounded-lg text-[clamp(1rem,3vw,2.75rem)] font-black",
                    question.played
                      ? "bg-slate-900 text-slate-700"
                      : "bg-blue-700 text-white",
                  ].join(" ")}
                  data-testid="display-board-price"
                  key={question.id}
                >
                  {question.played ? "—" : question.price}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
