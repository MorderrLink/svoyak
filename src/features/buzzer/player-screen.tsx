"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { BottomProgress } from "@/components/bottom-progress";
import { Button } from "@/components/button";
import { ErrorMessage } from "@/components/error-message";
import { LoadingState } from "@/components/loading-state";
import {
  getPlayerTokenStorageKey,
  playerFeedbackStorageKey,
} from "@/shared/constants/storage";
import type { PlayerScreenState } from "@/shared/contracts/socket";
import { playerTokenSchema } from "@/shared/schemas/socket";
import { createClientSocket } from "@/shared/socket/client";
import type { ApplicationClientSocket } from "@/shared/socket/client";

export interface PlayerScreenProps {
  roomCode: string;
}

const buttonLabels = {
  "answered-incorrectly": "Попытка использована",
  "other-player-answering": "Другой игрок был быстрее",
  ready: "НАЖАТЬ",
  "time-expired": "Время вышло",
  waiting: "Ожидание",
  winner: "Вы первый!",
} as const;

function playTone(frequency: number, durationMs: number): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const endsAt = context.currentTime + durationMs / 1_000;

    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.08, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, endsAt);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(endsAt);
    oscillator.addEventListener("ended", () => {
      void context.close();
    });
  } catch {
    // Некоторые браузеры запрещают Web Audio до первого пользовательского жеста.
  }
}

export function PlayerScreen({ roomCode }: PlayerScreenProps) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const lastSubmittedWindowRef = useRef<string | null>(null);
  const playerTokenRef = useRef<string | null>(null);
  const previousStatusRef = useRef<
    PlayerScreenState["buzzer"]["status"] | null
  >(null);
  const socketRef = useRef<ApplicationClientSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackEnabled, setFeedbackEnabled] = useState(false);
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<PlayerScreenState | null>(null);

  useEffect(() => {
    const storageKey = getPlayerTokenStorageKey(roomCode);
    const storedToken = window.localStorage.getItem(storageKey);
    const parsedToken = playerTokenSchema.safeParse(storedToken);

    if (!parsedToken.success) {
      window.localStorage.removeItem(storageKey);
      router.replace(`/join/${roomCode}`);
      return;
    }

    playerTokenRef.current = parsedToken.data;
    const socket = createClientSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setError(null);
      socket.emit(
        "player:reconnect",
        {
          playerToken: parsedToken.data,
          roomCode,
        },
        (result) => {
          if (!result.ok) {
            window.localStorage.removeItem(storageKey);
            setError(result.error.message);
            router.replace(`/join/${roomCode}`);
          }
        },
      );
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setSending(false);
    });
    socket.on("player:state", (nextState) => {
      setState(nextState);
      setSending(false);
    });
    socket.on("error", (socketError) => {
      setError(socketError.message);
    });
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, router]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setFeedbackEnabled(
          window.localStorage.getItem(playerFeedbackStorageKey) === "enabled",
        );
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const status = state?.buzzer.status ?? null;
    if (
      feedbackEnabled &&
      status !== null &&
      status !== previousStatusRef.current
    ) {
      if (status === "ready") {
        playTone(520, 120);
      } else if (status === "winner") {
        playTone(880, 220);
        navigator.vibrate?.([120, 60, 120]);
      }
    }
    previousStatusRef.current = status;
  }, [feedbackEnabled, state?.buzzer.status]);

  useEffect(() => {
    buttonRef.current?.focus({
      preventScroll: true,
    });
  }, [state?.buzzer.status]);

  const pressBuzzer = () => {
    const buzzWindowId = state?.buzzer.windowId;
    const playerToken = playerTokenRef.current;
    const socket = socketRef.current;

    if (
      state?.buzzer.status !== "ready" ||
      buzzWindowId === null ||
      buzzWindowId === undefined ||
      playerToken === null ||
      socket === null ||
      sending ||
      lastSubmittedWindowRef.current === buzzWindowId
    ) {
      return;
    }

    lastSubmittedWindowRef.current = buzzWindowId;
    setSending(true);
    setError(null);

    socket.emit(
      "buzzer:press",
      {
        buzzWindowId,
        playerToken,
        roomCode,
      },
      (result) => {
        if (!result.ok) {
          setSending(false);
          setError(result.error.message);
        }
      },
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  if (state === null) {
    return (
      <main className="grid h-full place-items-center bg-slate-950 text-white">
        <LoadingState>
          {connected ? "Восстанавливаем игрока…" : "Подключение…"}
        </LoadingState>
      </main>
    );
  }

  const status = state.buzzer.status;
  const ready = status === "ready" && connected && !sending;
  const label = sending
    ? "Отправка…"
    : connected
      ? buttonLabels[status]
      : "Нет соединения";

  return (
    <main className="relative flex h-full flex-col overflow-hidden bg-slate-950 p-4 text-white">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-slate-400">Игрок</p>
          <h1 className="truncate text-xl font-semibold">{state.name}</h1>
        </div>
        {state.showScore ? (
          <div className="text-right">
            <p className="text-xs text-slate-400">Баллы</p>
            <p className="text-xl font-semibold">{state.score}</p>
          </div>
        ) : null}
        <Button
          className="min-h-9 px-3 text-xs"
          onClick={() => {
            const enabled = !feedbackEnabled;
            setFeedbackEnabled(enabled);
            window.localStorage.setItem(
              playerFeedbackStorageKey,
              enabled ? "enabled" : "disabled",
            );
            if (enabled) {
              playTone(660, 100);
            }
          }}
          variant="secondary"
        >
          Эффекты: {feedbackEnabled ? "вкл" : "выкл"}
        </Button>
      </header>

      {error === null ? null : (
        <ErrorMessage className="mt-3">{error}</ErrorMessage>
      )}

      <div className="grid min-h-0 flex-1 place-items-center py-4">
        <Button
          aria-label={label}
          className={[
            "aspect-square h-auto max-h-full w-full max-w-[min(78vw,28rem)] rounded-full text-2xl shadow-2xl sm:text-4xl",
            ready
              ? "bg-blue-600 hover:bg-blue-500 active:scale-95"
              : status === "winner"
                ? "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-300",
          ].join(" ")}
          aria-disabled={!ready}
          onClick={pressBuzzer}
          onKeyDown={handleKeyDown}
          ref={buttonRef}
        >
          {label}
        </Button>
      </div>

      <BottomProgress timer={state.buzzer.timer} />
    </main>
  );
}
