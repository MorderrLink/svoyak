"use client";

import Image from "next/image";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";

import { BottomProgress } from "@/components/bottom-progress";
import { Button } from "@/components/button";
import { ErrorMessage } from "@/components/error-message";
import { getQuizAssetUrl } from "@/shared/api/quizzes";
import type {
  DisplayGameState,
  DisplayRoomState,
} from "@/shared/contracts/socket";
import { createClientSocket } from "@/shared/socket/client";
import type { ApplicationClientSocket } from "@/shared/socket/client";

export interface DisplayScreenProps {
  roomCode: string;
}

export function DisplayScreen({ roomCode }: DisplayScreenProps) {
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
          setError(result.error.message);
        }
      });
    });
    socket.on("disconnect", () => {
      setConnected(false);
    });
    socket.on("display:state", setState);
    socket.on("error", (socketError) => {
      setError(socketError.message);
    });
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode]);

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
        <div>
          <p className="text-[clamp(.75rem,1.2vw,1rem)] text-blue-300">
            {state?.quizTitle ?? "Свояк"}
          </p>
          <p className="font-mono text-[clamp(1.25rem,2.5vw,2.25rem)] font-bold tracking-[0.16em]">
            {roomCode}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={
              connected ? "text-sm text-emerald-300" : "text-sm text-red-300"
            }
          >
            {connected ? "В сети" : "Нет соединения"}
          </span>
          <Button
            className="min-h-9 px-3 text-sm"
            onClick={() => {
              void document.documentElement.requestFullscreen?.();
            }}
            variant="secondary"
          >
            На весь экран
          </Button>
        </div>
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
            <h1 className="mt-3 font-mono text-[clamp(3rem,10vw,8rem)] font-black tracking-[0.18em]">
              {state?.roomCode}
            </h1>
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
    return <DisplayBoard game={game} state={state} />;
  }

  if (game.phase === "game-finished") {
    return (
      <section className="grid h-full place-items-center">
        <div className="w-full max-w-5xl">
          <p className="text-center text-[clamp(1rem,2vw,1.5rem)] text-blue-300">
            Игра завершена
          </p>
          <h1 className="mt-2 text-center text-[clamp(2rem,5vw,4rem)] font-black">
            Итоговая таблица
          </h1>
          <ol className="mx-auto mt-6 max-w-3xl space-y-3">
            {state.players.map((player, index) => (
              <li
                className="flex items-center justify-between rounded-xl bg-slate-800 px-6 py-3 text-[clamp(1.1rem,2.5vw,2rem)]"
                key={`${player.name}-${index}`}
              >
                <span>
                  {index + 1}. {player.name}
                </span>
                {player.score === null ? null : <strong>{player.score}</strong>}
              </li>
            ))}
          </ol>
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

  const hasText = question.text !== null && question.text !== "";
  const hasImage = question.image !== null;

  return (
    <section className="flex h-full min-h-0 flex-col py-[clamp(1rem,2vh,2rem)]">
      <p className="shrink-0 text-center text-[clamp(.9rem,1.5vw,1.25rem)] text-blue-300">
        {question.themeTitle} · {question.price}
      </p>
      <div
        className={[
          "grid min-h-0 flex-1 items-center gap-[clamp(1rem,3vw,3rem)]",
          hasText && hasImage
            ? "md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
            : "place-items-center",
        ].join(" ")}
      >
        {hasText ? (
          <h1 className="max-h-full overflow-hidden text-[clamp(1.75rem,4.5vw,5rem)] leading-tight font-bold text-balance">
            {question.text}
          </h1>
        ) : null}
        {question.image === null ? null : (
          <Image
            alt={question.image.alt ?? "Изображение вопроса"}
            className="max-h-[62vh] w-full rounded-xl object-contain"
            height={900}
            priority
            src={getQuizAssetUrl(question.image.path)}
            unoptimized
            width={1400}
          />
        )}
      </div>

      {question.currentPlayerName === null ? null : (
        <p className="shrink-0 text-center text-[clamp(1.25rem,3vw,2.5rem)] font-semibold text-amber-300">
          Отвечает {question.currentPlayerName}
        </p>
      )}
      {question.answer === null ? null : (
        <div className="mt-3 shrink-0 rounded-xl bg-emerald-500/15 p-4 text-center">
          <p className="text-sm text-emerald-300">Правильный ответ</p>
          <p className="mt-1 text-[clamp(1.5rem,3.5vw,3rem)] font-bold">
            {question.answer}
          </p>
        </div>
      )}
    </section>
  );
}

function DisplayBoard({
  game,
  state,
}: {
  game: DisplayGameState;
  state: DisplayRoomState;
}) {
  const maxQuestionCount = Math.max(
    1,
    ...game.board.map((theme) => theme.questions.length),
  );

  return (
    <section className="grid h-full min-h-0 gap-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(12rem,20vw)]">
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
      <aside className="hidden min-h-0 rounded-xl bg-slate-900 p-4 lg:block">
        <p className="text-sm text-slate-400">
          Раунд {game.currentRoundIndex + 1} из {game.roundCount}
        </p>
        <h2 className="mt-1 text-xl font-semibold">Счёт</h2>
        <ol className="mt-3 space-y-2">
          {state.players.map((player, index) => (
            <li
              className="flex justify-between gap-2 rounded-lg bg-slate-800 px-3 py-2"
              key={`${player.name}-${index}`}
            >
              <span className="truncate">{player.name}</span>
              {player.score === null ? null : <strong>{player.score}</strong>}
            </li>
          ))}
        </ol>
      </aside>
    </section>
  );
}
