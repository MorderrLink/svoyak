"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { BottomProgress } from "@/components/bottom-progress";
import { Button } from "@/components/button";
import { ErrorMessage } from "@/components/error-message";
import { Input } from "@/components/input";
import { LoadingState } from "@/components/loading-state";
import { getPlayerTokenStorageKey } from "@/shared/constants/storage";
import type { PlayerScreenState } from "@/shared/contracts/socket";
import { playerTokenSchema } from "@/shared/schemas/socket";
import { createClientSocket } from "@/shared/socket/client";
import type { ApplicationClientSocket } from "@/shared/socket/client";

export interface PlayerScreenProps {
  roomCode: string;
}

const buttonLabels = {
  "answered-incorrectly": "НЕВЕРНО",
  correct: "ВЕРНО",
  "other-player-answering": "",
  queued: "НАЖАТО",
  ready: "НАЖАТЬ",
  "time-expired": "",
  waiting: "",
  winner: "",
} as const;

const accessibleButtonLabels = {
  "answered-incorrectly": "Неверный ответ",
  correct: "Верный ответ",
  "other-player-answering": "Другой игрок отвечает",
  queued: "Нажатие принято",
  ready: "НАЖАТЬ",
  "time-expired": "Время вышло",
  waiting: "Ожидание",
  winner: "Ответ принят, ждём решения ведущего",
} as const;

export function PlayerScreen({ roomCode }: PlayerScreenProps) {
  const router = useRouter();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const lastSubmittedWindowRef = useRef<string | null>(null);
  const playerTokenRef = useRef<string | null>(null);
  const socketRef = useRef<ApplicationClientSocket | null>(null);
  const wagerActiveRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [state, setState] = useState<PlayerScreenState | null>(null);
  const [wagerInput, setWagerInput] = useState("100");

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
    const measurePing = () => {
      if (!socket.connected) {
        return;
      }

      const startedAt = performance.now();
      socket.emit("player:ping", {}, (result) => {
        if (!result.ok || !socket.connected) {
          return;
        }

        const pingMs = Math.max(0, Math.round(performance.now() - startedAt));
        socket.emit("player:telemetry", { pingMs }, () => undefined);
      });
    };
    const pingInterval = window.setInterval(measurePing, 10_000);

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
            if (result.error.code === "ROOM_NOT_FOUND") {
              router.replace("/");
              return;
            }
            setError(result.error.message);
            router.replace(`/join/${roomCode}`);
            return;
          }
          measurePing();
        },
      );
    });
    socket.on("disconnect", () => {
      setConnected(false);
      setSending(false);
    });
    socket.on("player:state", (nextState) => {
      if (nextState.wager !== null && !wagerActiveRef.current) {
        setWagerInput(String(nextState.wager.value));
      }
      wagerActiveRef.current = nextState.wager !== null;
      setState(nextState);
      setSending(false);
    });
    socket.on("error", (socketError) => {
      if (socketError.code === "ROOM_NOT_FOUND") {
        router.replace("/");
        return;
      }
      setError(socketError.message);
    });
    socket.connect();

    return () => {
      window.clearInterval(pingInterval);
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, router]);

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

  const submitWager = () => {
    const socket = socketRef.current;
    const playerToken = playerTokenRef.current;
    const wager = Number(wagerInput);
    if (
      socket === null ||
      playerToken === null ||
      state?.wager === null ||
      state?.wager === undefined ||
      state.wager.submitted ||
      !Number.isInteger(wager) ||
      wager < 100 ||
      wager > state.wager.maximum ||
      wager % 100 !== 0
    ) {
      setError(`Ставка должна быть от 100 до ${state?.wager?.maximum ?? 100}`);
      return;
    }
    setSending(true);
    socket.emit("wager:submit", { playerToken, roomCode, wager }, (result) => {
      setSending(false);
      if (!result.ok) setError(result.error.message);
    });
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
  const queuePosition = state.buzzer.position;
  const answerDelta = state.answerDelta;
  const formattedAnswerDelta =
    answerDelta === null
      ? null
      : answerDelta > 0
        ? `+${answerDelta}`
        : String(answerDelta);
  const label = connected ? buttonLabels[status] : "";
  const accessibleLabel = sending
    ? "Отправка нажатия"
    : connected
      ? status === "queued" && queuePosition !== null
        ? `Нажатие принято, вы в очереди ${queuePosition}`
        : (status === "correct" || status === "answered-incorrectly") &&
            formattedAnswerDelta !== null
          ? `${accessibleButtonLabels[status]}, ${formattedAnswerDelta} баллов`
          : accessibleButtonLabels[status]
      : "Нет соединения";

  return (
    <main className="relative flex h-full flex-col overflow-hidden bg-slate-950 p-4 text-white">
      <header className="flex flex-wrap items-center justify-between gap-3">
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
            router.push("/");
          }}
          variant="secondary"
        >
          На главную
        </Button>
      </header>

      {error === null ? null : (
        <ErrorMessage className="mt-3">{error}</ErrorMessage>
      )}

      {state.wager === null ? (
        <div className="grid min-h-0 flex-1 place-items-center py-4">
          <Button
            aria-label={accessibleLabel}
            className={[
              "aspect-square h-auto max-h-full w-full max-w-[min(78vw,28rem)] rounded-[38%] text-2xl font-black shadow-2xl sm:text-4xl",
              ready
                ? "bg-blue-600 hover:bg-blue-500 active:scale-95"
                : status === "correct"
                  ? "bg-emerald-600 text-white"
                  : status === "answered-incorrectly"
                    ? "bg-red-600 text-white"
                    : status === "queued"
                      ? "scale-[0.97] bg-blue-800 text-blue-100 shadow-inner ring-4 ring-blue-400/50"
                      : "bg-slate-700 text-slate-300",
            ].join(" ")}
            aria-disabled={!ready}
            onClick={pressBuzzer}
            onKeyDown={handleKeyDown}
            ref={buttonRef}
          >
            {status === "queued" && queuePosition !== null ? (
              <span className="flex flex-col items-center gap-3">
                <span>{label}</span>
                <span className="text-base font-bold sm:text-xl">
                  ВЫ В ОЧЕРЕДИ: {queuePosition}
                </span>
              </span>
            ) : (status === "correct" || status === "answered-incorrectly") &&
              formattedAnswerDelta !== null ? (
              <span className="flex flex-col items-center gap-3">
                <span>{label}</span>
                <span className="text-base font-bold sm:text-xl">
                  {formattedAnswerDelta} БАЛЛОВ
                </span>
              </span>
            ) : (
              label
            )}
          </Button>
        </div>
      ) : (
        <section className="mx-auto flex min-h-0 w-full max-w-sm flex-1 flex-col justify-center py-4 text-center">
          <p className="text-sm font-semibold text-blue-300">
            Вопрос со ставкой
          </p>
          <h2 className="mt-1 text-2xl font-black">
            {state.wager.submitted ? "Ставка принята" : "Сделайте ставку"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Максимум: {state.wager.maximum}
          </p>
          <Input
            aria-label="Ставка"
            className="mt-4 text-center text-3xl font-black"
            inputMode="numeric"
            max={state.wager.maximum}
            min={100}
            onChange={(event) =>
              setWagerInput(event.target.value.replace(/\D/g, ""))
            }
            readOnly={state.wager.submitted}
            step={100}
            value={wagerInput}
          />
          {state.wager.submitted ? (
            <p className="mt-6 rounded-2xl bg-emerald-900/50 p-5 text-lg font-bold text-emerald-200">
              Ждём ставки остальных игроков
            </p>
          ) : (
            <>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((digit) => (
                  <Button
                    className={digit === 0 ? "col-start-2" : ""}
                    key={digit}
                    onClick={() =>
                      setWagerInput((current) =>
                        `${current === "0" ? "" : current}${digit}`.slice(0, 7),
                      )
                    }
                    variant="surface"
                  >
                    {digit}
                  </Button>
                ))}
                <Button
                  className="col-start-3 row-start-4"
                  onClick={() =>
                    setWagerInput((current) => current.slice(0, -1) || "0")
                  }
                  variant="secondary"
                >
                  ⌫
                </Button>
              </div>
              <Button
                className="mt-3 min-h-14 text-lg"
                disabled={sending}
                onClick={submitWager}
              >
                {sending ? "Отправляем…" : "Подтвердить ставку"}
              </Button>
            </>
          )}
        </section>
      )}

      <BottomProgress timer={state.buzzer.timer} />
    </main>
  );
}
