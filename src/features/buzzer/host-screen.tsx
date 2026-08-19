"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BottomProgress } from "@/components/bottom-progress";
import { Button } from "@/components/button";
import { Dialog } from "@/components/dialog";
import { ErrorMessage } from "@/components/error-message";
import { Input } from "@/components/input";
import { QuestionMediaPlayer } from "@/components/question-media-player";
import { ScrollArea } from "@/components/scroll-area";
import { listQuizzes } from "@/shared/api/quizzes";
import { getQuizAssetUrl } from "@/shared/api/quizzes";
import { hostSessionStorageKey } from "@/shared/constants/storage";
import type {
  AnswerJudgement,
  CreateRoomResult,
  GameBoardTheme,
  HostPlayer,
  HostRoomState,
  ScoreChangeProposal,
  SocketError,
} from "@/shared/contracts/socket";
import { PLAYER_NAME_MAX_LENGTH } from "@/shared/player/player-name";
import { hostSessionSchema, roomNameSchema } from "@/shared/schemas/socket";
import { createClientSocket } from "@/shared/socket/client";
import type { ApplicationClientSocket } from "@/shared/socket/client";
import type { QuizSummary } from "@/shared/types/quiz";

function readStoredSession(): CreateRoomResult | null {
  const value = window.localStorage.getItem(hostSessionStorageKey);
  if (value === null) return null;

  try {
    const parsed = hostSessionSchema.safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function selectPreferredUrl(urls: string[]): string {
  const currentOrigin = window.location.origin;
  return (
    urls.find(
      (url) =>
        url === currentOrigin &&
        !url.includes("localhost") &&
        !url.includes("127.0.0.1"),
    ) ??
    urls.find((url) => url.includes("192.168.") || url.includes("10.")) ??
    urls[0] ??
    currentOrigin
  );
}

function getErrorMessage(error: SocketError): string {
  return error.message;
}

export interface HostScreenProps {
  roomCode?: string;
}

export function HostScreen({ roomCode }: HostScreenProps) {
  const router = useRouter();
  const socketRef = useRef<ApplicationClientSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingQuizzes, setLoadingQuizzes] = useState(true);
  const [manualScorePlayerId, setManualScorePlayerId] = useState<string | null>(
    null,
  );
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  const [roomState, setRoomState] = useState<HostRoomState | null>(null);
  const [selectedBaseUrl, setSelectedBaseUrl] = useState("");
  const [selectedQuizId, setSelectedQuizId] = useState("");
  const [session, setSession] = useState<CreateRoomResult | null>(null);

  useEffect(() => {
    let active = true;
    const requestedQuizId = new URLSearchParams(window.location.search).get(
      "quizId",
    );

    void listQuizzes()
      .then((items) => {
        if (!active) return;
        setQuizzes(items);
        setSelectedQuizId(
          items.some((quiz) => quiz.id === requestedQuizId)
            ? (requestedQuizId ?? "")
            : (items[0]?.id ?? ""),
        );
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Не удалось загрузить викторины",
          );
        }
      })
      .finally(() => {
        if (active) setLoadingQuizzes(false);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const socket = createClientSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      const storedSession = readStoredSession();
      if (roomCode === undefined) return;
      if (storedSession === null || storedSession.roomCode !== roomCode) {
        setError("В этом браузере нет токена управления данной комнатой");
        return;
      }

      setSession(storedSession);
      setSelectedBaseUrl(selectPreferredUrl(storedSession.applicationUrls));
      socket.emit(
        "host:reconnect",
        {
          hostToken: storedSession.hostToken,
          roomCode: storedSession.roomCode,
        },
        (result) => {
          if (!result.ok) {
            window.localStorage.removeItem(hostSessionStorageKey);
            setSession(null);
            setRoomState(null);
            if (result.error.code === "ROOM_NOT_FOUND") {
              router.replace("/");
              return;
            }
            setError(getErrorMessage(result.error));
          }
        },
      );
    });
    socket.on("disconnect", () => {
      setConnected(false);
    });
    socket.on("host:state", setRoomState);
    socket.on("error", (socketError) => {
      if (socketError.code === "ROOM_NOT_FOUND") {
        router.replace("/");
        return;
      }
      setError(getErrorMessage(socketError));
    });
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode, router]);

  const proposal = roomState?.game?.scoreProposal ?? null;
  const activeTimer = roomState?.game?.timer ?? roomState?.buzzer.timer ?? null;
  const canSkipCurrentPhase =
    activeTimer !== null || roomState?.game?.phase === "theme-explanation";

  useEffect(() => {
    if (!canSkipCurrentPhase || session === null) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (
        event.code !== "Space" ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      event.preventDefault();
      socketRef.current?.emit(
        "timer:skip",
        {
          hostToken: session.hostToken,
          roomCode: session.roomCode,
        },
        (result) => {
          if (!result.ok) setError(result.error.message);
        },
      );
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [canSkipCurrentPhase, session]);

  const joinUrl = useMemo(() => {
    if (session === null || selectedBaseUrl === "") return null;
    return `${selectedBaseUrl}/join/${session.roomCode}`;
  }, [selectedBaseUrl, session]);

  useEffect(() => {
    if (joinUrl === null) return;
    let active = true;
    void QRCode.toDataURL(joinUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
    })
      .then((dataUrl) => {
        if (active) setQrCode(dataUrl);
      })
      .catch(() => {
        if (active) setError("Не удалось создать QR-код");
      });
    return () => {
      active = false;
    };
  }, [joinUrl]);

  const createRoom = () => {
    const socket = socketRef.current;
    if (socket === null || !connected || selectedQuizId === "") {
      setError("Выберите викторину и дождитесь соединения с сервером");
      return;
    }

    socket.emit("room:create", { quizId: selectedQuizId }, (result) => {
      if (!result.ok) {
        setError(getErrorMessage(result.error));
        return;
      }
      window.localStorage.setItem(
        hostSessionStorageKey,
        JSON.stringify(result.data),
      );
      setSession(result.data);
      setSelectedBaseUrl(selectPreferredUrl(result.data.applicationUrls));
      setError(null);
      router.push(`/host/${result.data.roomCode}`);
    });
  };

  const command = (
    event:
      | "media:restart"
      | "media:stop"
      | "question:finish"
      | "score:cancel"
      | "session:finish"
      | "session:start",
  ) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      event,
      { hostToken: session.hostToken, roomCode: session.roomCode },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  const selectQuestion = (questionId: string) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "question:select",
      {
        hostToken: session.hostToken,
        questionId,
        roomCode: session.roomCode,
      },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  const changeRound = (roundIndex: number) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "round:change",
      {
        hostToken: session.hostToken,
        roomCode: session.roomCode,
        roundIndex,
      },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  const judge = (judgement: AnswerJudgement) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "answer:judge",
      {
        hostToken: session.hostToken,
        judgement,
        roomCode: session.roomCode,
      },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  const selectAnsweringPlayer = (playerId: string) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "answer:select",
      {
        hostToken: session.hostToken,
        playerId,
        roomCode: session.roomCode,
      },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  const reopenBuzzer = () => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "buzzer:open",
      {
        durationMs: 10_000,
        hostToken: session.hostToken,
        roomCode: session.roomCode,
      },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  const confirmScore = (proposalId: string, delta: number) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "score:confirm",
      {
        delta,
        hostToken: session.hostToken,
        proposalId,
        roomCode: session.roomCode,
      },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  const updatePlayer = (playerId: string, name: string, delta: number) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "player:update",
      {
        delta,
        hostToken: session.hostToken,
        name,
        playerId,
        roomCode: session.roomCode,
      },
      (result) => {
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        setManualScorePlayerId(null);
      },
    );
  };

  const explainTheme = (themeId: string) => {
    const socket = socketRef.current;
    if (socket === null || session === null) return;
    socket.emit(
      "theme:explain",
      {
        hostToken: session.hostToken,
        roomCode: session.roomCode,
        themeId,
      },
      (result) => {
        if (!result.ok) setError(result.error.message);
      },
    );
  };

  if (session === null) {
    if (roomCode !== undefined) {
      return (
        <main className="grid h-full place-items-center bg-slate-950 p-6 text-white">
          <section className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 text-center">
            <h1 className="text-2xl font-semibold">Нет доступа к комнате</h1>
            <p className="mt-3 text-slate-300">
              Откройте панель в браузере, где создавалась комната.
            </p>
            {error === null ? null : (
              <ErrorMessage className="mt-4">{error}</ErrorMessage>
            )}
            <Link
              className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2"
              href="/host"
            >
              Создать новую комнату
            </Link>
          </section>
        </main>
      );
    }

    return (
      <main className="grid h-full place-items-center bg-slate-950 p-6 text-white">
        <section className="w-full max-w-xl rounded-2xl bg-slate-900 p-6 shadow-2xl">
          <p className="text-sm font-medium text-blue-300">Панель ведущего</p>
          <h1 className="mt-2 text-3xl font-semibold">Создать комнату</h1>
          <p className="mt-3 text-slate-300">
            Выберите сохранённую викторину. Сервер сделает её независимый снимок
            для этой игры.
          </p>
          {error === null ? null : (
            <ErrorMessage className="mt-4">{error}</ErrorMessage>
          )}
          {loadingQuizzes ? (
            <p className="mt-5 text-slate-300">Загружаем библиотеку…</p>
          ) : quizzes.length === 0 ? (
            <Link
              className="mt-5 inline-flex min-h-11 items-center rounded-lg bg-blue-600 px-4 py-2"
              href="/editor/new"
            >
              Создать первую викторину
            </Link>
          ) : (
            <>
              <label className="mt-5 block">
                <span className="mb-1 block text-sm text-slate-300">
                  Викторина
                </span>
                <select
                  aria-label="Викторина"
                  className="min-h-11 w-full rounded-lg bg-white px-3 text-slate-950"
                  onChange={(event) => {
                    setSelectedQuizId(event.target.value);
                  }}
                  value={selectedQuizId}
                >
                  {quizzes.map((quiz) => (
                    <option key={quiz.id} value={quiz.id}>
                      {quiz.title} · {quiz.questionCount} вопросов
                    </option>
                  ))}
                </select>
              </label>
              <Button
                className="mt-5 w-full"
                disabled={!connected}
                onClick={createRoom}
              >
                {connected ? "Создать комнату" : "Подключение к серверу…"}
              </Button>
            </>
          )}
          <Link
            className="mt-4 block text-center text-blue-300"
            href="/library"
          >
            Открыть библиотеку
          </Link>
        </section>
      </main>
    );
  }

  const game = roomState?.game ?? null;
  const activeQuestion = game?.activeQuestion ?? null;
  const canAdjustPlayerScore =
    game === null ||
    game.phase === "board" ||
    game.phase === "round-finished" ||
    game.phase === "game-finished";
  const manualScorePlayer =
    roomState?.players.find((player) => player.id === manualScorePlayerId) ??
    null;

  return (
    <main
      className={[
        "relative h-full overflow-hidden bg-slate-950 p-4 text-white",
        game === null
          ? "flex"
          : "grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]",
      ].join(" ")}
    >
      <section className="flex min-h-0 w-full flex-col rounded-2xl bg-slate-900 p-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-blue-300">
              {roomState?.quizTitle ?? session.quizTitle}
            </p>
            <h1
              className="font-mono text-4xl font-bold tracking-[0.18em]"
              data-testid="room-code"
            >
              {session.roomCode}
            </h1>
          </div>
          <span className={connected ? "text-emerald-300" : "text-red-300"}>
            {connected ? "Сервер подключён" : "Нет соединения"}
          </span>
          {roomState?.game !== null &&
          roomState?.game !== undefined &&
          roomState.game.phase !== "game-finished" ? (
            <Button
              onClick={() => {
                command("session:finish");
              }}
              variant="danger"
            >
              Завершить игру
            </Button>
          ) : null}
          <Button
            onClick={() => {
              window.open(
                `/display/${session.roomCode}`,
                `svoyak-display-${session.roomCode}`,
              );
            }}
            variant="secondary"
          >
            Открыть публичный экран
          </Button>
          <Button
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

        <ScrollArea className="mt-4 flex-1">
          {game === null ? (
            <Lobby
              applicationUrls={session.applicationUrls}
              joinUrl={joinUrl}
              onChangeBaseUrl={setSelectedBaseUrl}
              onSelectPlayer={setManualScorePlayerId}
              onStart={() => {
                command("session:start");
              }}
              players={roomState?.players ?? []}
              qrCode={qrCode}
              selectedBaseUrl={selectedBaseUrl}
            />
          ) : game.phase === "board" ? (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold">
                  Раунд {game.currentRoundIndex + 1} из {game.roundCount}
                </h2>
                <div className="flex gap-2">
                  <Button
                    aria-label="Предыдущий раунд"
                    disabled={game.currentRoundIndex === 0}
                    onClick={() => {
                      changeRound(game.currentRoundIndex - 1);
                    }}
                    variant="secondary"
                  >
                    ← Назад
                  </Button>
                  <Button
                    aria-label="Следующий раунд"
                    disabled={game.currentRoundIndex + 1 >= game.roundCount}
                    onClick={() => {
                      changeRound(game.currentRoundIndex + 1);
                    }}
                    variant="secondary"
                  >
                    Вперёд →
                  </Button>
                </div>
              </div>
              <HostBoard
                board={game.board}
                onExplain={explainTheme}
                onSelect={selectQuestion}
              />
            </section>
          ) : game.phase === "theme-explanation" ? (
            <ThemeExplanationCard
              description={game.activeThemeExplanation?.description ?? ""}
              title={game.activeThemeExplanation?.title ?? "Пояснение темы"}
            />
          ) : game.phase === "question-intro" ? (
            <PhaseCard
              eyebrow={`Вопрос за ${activeQuestion?.price ?? ""}`}
              title={activeQuestion?.themeTitle ?? ""}
            />
          ) : game.phase === "game-finished" ? (
            <section>
              <p className="text-sm text-blue-300">Игра завершена</p>
              <h2 className="mt-1 text-3xl font-semibold">Итоговая таблица</h2>
              <ol className="mt-5 space-y-2">
                {(roomState?.players ?? []).map((player, index) => (
                  <li
                    className="flex justify-between rounded-xl bg-slate-800 px-5 py-4 text-xl"
                    key={player.id}
                  >
                    <span>
                      {index + 1}. {player.name}
                    </span>
                    <strong>{player.score}</strong>
                  </li>
                ))}
              </ol>
            </section>
          ) : (
            <section>
              <p className="text-sm text-blue-300">
                {activeQuestion?.themeTitle} · {activeQuestion?.price}
              </p>
              {activeQuestion?.text === null ? null : (
                <h2 className="mt-2 text-3xl font-semibold">
                  {activeQuestion?.text}
                </h2>
              )}
              {activeQuestion?.image === null ||
              activeQuestion?.image === undefined ? null : (
                <Image
                  alt={activeQuestion.image.alt ?? "Изображение вопроса"}
                  className="mt-5 max-h-[40vh] w-full rounded-xl object-contain"
                  height={720}
                  src={getQuizAssetUrl(activeQuestion.image.path)}
                  unoptimized
                  width={1280}
                />
              )}
              {activeQuestion?.media === null ||
              activeQuestion?.media === undefined ||
              game.phase === "answer-reveal" ? null : (
                <div className="mt-5 flex max-h-[44vh] min-h-52 flex-col rounded-xl bg-slate-950/70 p-4">
                  <QuestionMediaPlayer
                    media={activeQuestion.media}
                    playback={game.mediaPlayback}
                  />
                  <div className="mt-3 flex justify-center gap-3">
                    <Button
                      onClick={() => {
                        command("media:restart");
                      }}
                    >
                      ▶ С начала
                    </Button>
                    <Button
                      disabled={game.mediaPlayback === null}
                      onClick={() => {
                        command("media:stop");
                      }}
                      variant="secondary"
                    >
                      {game.mediaPlayback?.playing === true
                        ? "⏸ Пауза"
                        : "▶ Продолжить"}
                    </Button>
                  </div>
                </div>
              )}
              <div className="mt-5 rounded-xl bg-slate-950/70 p-4">
                <p className="text-xs text-slate-400">Правильный ответ</p>
                {activeQuestion?.answer === "" ? null : (
                  <p className="mt-1 text-xl">{activeQuestion?.answer}</p>
                )}
                {activeQuestion?.answerImage === null ||
                activeQuestion?.answerImage === undefined ? null : (
                  <Image
                    alt={activeQuestion.answerImage.alt ?? "Изображение ответа"}
                    className="mt-3 max-h-[28vh] w-full rounded-xl object-contain"
                    height={540}
                    src={getQuizAssetUrl(activeQuestion.answerImage.path)}
                    unoptimized
                    width={960}
                  />
                )}
                {activeQuestion?.hostComment === null ? null : (
                  <p className="mt-3 text-sm text-slate-300">
                    {activeQuestion?.hostComment}
                  </p>
                )}
              </div>

              {game.phase === "answer-reveal" ? null : (
                <QuestionPlayerGrid
                  attemptedPlayerIds={activeQuestion?.attemptedPlayerIds ?? []}
                  onSelect={selectAnsweringPlayer}
                  players={roomState?.players ?? []}
                  selectable={game.phase === "buzzing"}
                />
              )}

              {game.phase === "buzzing" ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <p className="w-full text-lg">
                    Выберите нажавшего игрока, который будет отвечать.
                  </p>
                  <Button
                    onClick={() => {
                      command("question:finish");
                    }}
                    variant="secondary"
                  >
                    Никто не ответил
                  </Button>
                  {roomState?.buzzer.closeReason === "expired" ? (
                    <Button onClick={reopenBuzzer}>
                      Повторить окно нажатия
                    </Button>
                  ) : null}
                </div>
              ) : game.phase === "answering" ? (
                <AnswerDecisionDialog
                  onJudge={judge}
                  playerName={
                    roomState?.players.find(
                      (player) => player.id === activeQuestion?.currentPlayerId,
                    )?.name ?? "Игрок"
                  }
                />
              ) : game.phase === "score-confirmation" && proposal !== null ? (
                <ScoreConfirmation
                  key={proposal.id}
                  onCancel={() => {
                    command("score:cancel");
                  }}
                  onConfirm={confirmScore}
                  proposal={proposal}
                />
              ) : game.phase === "answer-reveal" ? (
                <p className="mt-5 text-xl text-emerald-300">
                  Ответ раскрыт. Скоро вернёмся к сетке.
                </p>
              ) : null}
            </section>
          )}
        </ScrollArea>
      </section>

      {game === null ? null : (
        <aside className="min-h-0 overflow-auto rounded-2xl bg-slate-900 p-5 text-white">
          <GamePlayerPanel
            canAdjustScore={canAdjustPlayerScore}
            onSelectPlayer={setManualScorePlayerId}
            players={roomState?.players ?? []}
          />
        </aside>
      )}

      {manualScorePlayer === null || !canAdjustPlayerScore ? null : (
        <ManualScoreDialog
          key={manualScorePlayer.id}
          onCancel={() => {
            setManualScorePlayerId(null);
          }}
          onConfirm={(name, delta) => {
            updatePlayer(manualScorePlayer.id, name, delta);
          }}
          player={manualScorePlayer}
        />
      )}

      {!canSkipCurrentPhase ? null : (
        <p className="fixed right-4 bottom-3 z-40 rounded-lg bg-slate-950/85 px-3 py-1 text-xs font-semibold text-white shadow-lg">
          {game?.phase === "theme-explanation"
            ? "Space — закрыть пояснение"
            : "Space — пропустить таймер"}
        </p>
      )}
      <BottomProgress timer={activeTimer} />
    </main>
  );
}

function formatConnectionTime(timestamp: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function Lobby({
  applicationUrls,
  joinUrl,
  onChangeBaseUrl,
  onSelectPlayer,
  onStart,
  players,
  qrCode,
  selectedBaseUrl,
}: {
  applicationUrls: string[];
  joinUrl: string | null;
  onChangeBaseUrl: (url: string) => void;
  onSelectPlayer: (playerId: string) => void;
  onStart: () => void;
  players: HostPlayer[];
  qrCode: string | null;
  selectedBaseUrl: string;
}) {
  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col items-center pb-6">
      <div className="text-center">
        <p className="text-sm font-semibold text-blue-300">Лобби</p>
        <h2 className="mt-1 text-3xl font-bold">Подключение игроков</h2>
        <p className="mt-2 text-slate-300">
          После начала викторины подключение новых игроков закроется.
        </p>
      </div>

      <div className="mt-6 grid w-full max-w-4xl items-center gap-6 rounded-3xl border border-slate-700 bg-slate-800 p-6 md:grid-cols-[auto_1fr]">
        {qrCode === null ? (
          <div className="grid size-[220px] place-items-center rounded-2xl bg-slate-700 text-sm text-slate-300">
            Формируем QR-код…
          </div>
        ) : (
          <Image
            alt="QR-код для подключения к комнате"
            className="mx-auto rounded-2xl bg-white p-2"
            height={220}
            priority
            src={qrCode}
            unoptimized
            width={220}
          />
        )}
        <div className="min-w-0">
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-slate-300">
              Адрес для подключения
            </span>
            <select
              aria-label="Адрес локальной сети"
              className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-900 px-3 text-white"
              onChange={(event) => {
                onChangeBaseUrl(event.target.value);
              }}
              value={selectedBaseUrl}
            >
              {applicationUrls.map((url) => (
                <option key={url} value={url}>
                  {url}
                </option>
              ))}
            </select>
          </label>
          {joinUrl === null ? null : (
            <a
              className="mt-3 block text-sm break-all text-blue-300 underline"
              href={joinUrl}
            >
              {joinUrl}
            </a>
          )}
          <Button
            className="mt-5 w-full rounded-xl"
            disabled={players.length === 0}
            onClick={onStart}
          >
            Начать викторину
          </Button>
        </div>
      </div>

      <div className="mt-8 w-full">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xl font-bold">Подключились</h3>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-300">
            {players.length}
          </span>
        </div>
        {players.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
            Ожидаем игроков…
          </p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {players.map((player) => (
              <button
                aria-label={`Изменить баллы игрока ${player.name}`}
                className="relative rounded-2xl border border-slate-700 bg-slate-800 p-4 text-left hover:border-blue-400 hover:bg-slate-700"
                data-testid="lobby-player-card"
                key={player.id}
                onClick={() => {
                  onSelectPlayer(player.id);
                }}
                type="button"
              >
                <h4 className="pr-6 text-lg font-bold">{player.name}</h4>
                <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-slate-400">Подключён</dt>
                  <dd>{formatConnectionTime(player.joinedAt)}</dd>
                  <dt className="text-slate-400">Устройство</dt>
                  <dd className="truncate" title={player.device}>
                    {player.device}
                  </dd>
                  <dt className="text-slate-400">Ping</dt>
                  <dd>
                    {player.connected
                      ? player.pingMs === null
                        ? "измеряется…"
                        : `${player.pingMs} мс`
                      : "—"}
                  </dd>
                </dl>
                <span
                  aria-label={player.connected ? "Онлайн" : "Оффлайн"}
                  className={[
                    "absolute top-4 right-4 size-3 rounded-full",
                    player.connected ? "bg-emerald-400" : "bg-red-500",
                  ].join(" ")}
                  role="status"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function HostBoard({
  board,
  onExplain,
  onSelect,
}: {
  board: GameBoardTheme[];
  onExplain: (themeId: string) => void;
  onSelect: (questionId: string) => void;
}) {
  const maxQuestionCount = Math.max(
    1,
    ...board.map((theme) => theme.questions.length),
  );

  return (
    <div
      className="mt-5 grid gap-2"
      style={{
        gridTemplateColumns: `minmax(10rem, 1.4fr) repeat(${maxQuestionCount}, minmax(4rem, 1fr))`,
      }}
    >
      {board.map((theme) => (
        <div className="contents" key={theme.id}>
          <div className="relative grid min-h-16 place-items-center rounded-lg bg-slate-800 p-3 pr-11 text-center font-semibold">
            <h3>{theme.title}</h3>
            <button
              aria-label={`Показать пояснение темы ${theme.title}`}
              className="absolute top-2 right-2 grid size-7 place-items-center rounded-full border border-blue-300 bg-blue-600 text-sm font-black text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:border-slate-600 disabled:bg-slate-700 disabled:text-slate-500"
              disabled={theme.description === null}
              onClick={() => {
                onExplain(theme.id);
              }}
              title={
                theme.description === null
                  ? "Пояснение для темы не заполнено"
                  : "Показать пояснение темы"
              }
              type="button"
            >
              ?
            </button>
          </div>
          {Array.from({ length: maxQuestionCount }, (_, questionIndex) => {
            const question = theme.questions[questionIndex];

            return question === undefined ? (
              <div
                aria-hidden
                className="min-h-16 rounded-lg bg-slate-950/30"
                key={`${theme.id}-empty-${questionIndex}`}
              />
            ) : (
              <Button
                aria-label={`${theme.title}, ${question.price}`}
                className="min-h-16 text-xl"
                data-testid="host-board-price"
                disabled={question.played}
                key={question.id}
                onClick={() => {
                  onSelect(question.id);
                }}
                variant={question.played ? "secondary" : "primary"}
              >
                {question.played ? "—" : question.price}
              </Button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function GamePlayerPanel({
  canAdjustScore,
  onSelectPlayer,
  players,
}: {
  canAdjustScore: boolean;
  onSelectPlayer: (playerId: string) => void;
  players: HostPlayer[];
}) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold">Игроки</h2>
        <span className="rounded-full bg-slate-800 px-3 py-1 text-sm text-slate-300">
          {players.length}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {players.length === 0 ? (
          <p className="col-span-2 text-sm text-slate-400">Пока никого</p>
        ) : (
          players.map((player) => (
            <button
              aria-label={`Изменить баллы игрока ${player.name}`}
              className="relative grid aspect-square place-content-center rounded-2xl border border-slate-700 bg-slate-800 p-3 text-center enabled:hover:border-blue-400 enabled:hover:bg-slate-700 disabled:cursor-default"
              data-testid="game-player-card"
              disabled={!canAdjustScore}
              key={player.id}
              onClick={() => {
                onSelectPlayer(player.id);
              }}
              type="button"
            >
              <h3 className="line-clamp-2 font-bold">{player.name}</h3>
              <p className="mt-1 text-sm text-slate-300">
                {player.score} баллов
              </p>
              <span
                aria-label={player.connected ? "Онлайн" : "Оффлайн"}
                className={[
                  "absolute right-3 bottom-3 size-4 rounded-full ring-2 ring-slate-900",
                  player.connected ? "bg-emerald-400" : "bg-red-500",
                ].join(" ")}
                role="status"
              />
            </button>
          ))
        )}
      </div>
    </section>
  );
}

function QuestionPlayerGrid({
  attemptedPlayerIds,
  onSelect,
  players,
  selectable,
}: {
  attemptedPlayerIds: string[];
  onSelect: (playerId: string) => void;
  players: HostPlayer[];
  selectable: boolean;
}) {
  return (
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {players.map((player) => {
        const hasAnsweredIncorrectly = attemptedPlayerIds.includes(player.id);
        const canSelect =
          selectable && player.buzzPosition !== null && !hasAnsweredIncorrectly;

        return (
          <button
            aria-label={
              hasAnsweredIncorrectly
                ? `${player.name} уже ответил неверно`
                : player.buzzPosition === null
                  ? `${player.name} не нажал`
                  : `Выбрать ${player.name} для ответа, нажатие ${player.buzzPosition}`
            }
            className={[
              "relative min-h-24 rounded-2xl border-2 px-5 py-4 text-left transition",
              hasAnsweredIncorrectly
                ? "border-red-500 bg-red-950/70"
                : "border-slate-700 bg-slate-800 hover:border-blue-400 hover:bg-slate-700 disabled:cursor-default disabled:hover:border-slate-700 disabled:hover:bg-slate-800",
            ].join(" ")}
            disabled={!canSelect}
            key={player.id}
            onClick={() => {
              onSelect(player.id);
            }}
            type="button"
          >
            <span
              className={[
                "absolute top-3 right-3 grid size-9 place-items-center rounded-full border-2 text-sm font-black",
                hasAnsweredIncorrectly
                  ? "border-red-300 bg-red-600 text-white"
                  : player.buzzPosition === null
                    ? "border-slate-600 text-transparent"
                    : "border-blue-300 bg-blue-600 text-white",
              ].join(" ")}
            >
              {player.buzzPosition ?? ""}
            </span>
            <span className="block max-w-[calc(100%-3rem)] truncate text-lg font-bold">
              {player.name}
            </span>
            <span className="mt-2 block text-sm text-slate-300">
              {player.score} баллов
            </span>
          </button>
        );
      })}
    </div>
  );
}

function PhaseCard({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <section className="grid min-h-80 place-items-center text-center">
      <div>
        <p className="text-xl text-blue-300">{eyebrow}</p>
        <h2 className="mt-3 text-5xl font-bold">{title}</h2>
      </div>
    </section>
  );
}

function ThemeExplanationCard({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <section className="grid min-h-full place-items-center py-6 text-center">
      <div className="max-w-4xl">
        <p className="text-lg font-semibold text-blue-300">Пояснение темы</p>
        <h2 className="mt-2 text-4xl font-black text-balance">{title}</h2>
        <p className="mt-7 text-2xl leading-relaxed whitespace-pre-line text-slate-100">
          {description}
        </p>
        <p className="mt-8 text-sm font-semibold text-slate-400">
          Нажмите Space, когда все прочитают пояснение
        </p>
      </div>
    </section>
  );
}

function AnswerDecisionDialog({
  onJudge,
  playerName,
}: {
  onJudge: (judgement: AnswerJudgement) => void;
  playerName: string;
}) {
  const onJudgeRef = useRef(onJudge);

  useEffect(() => {
    onJudgeRef.current = onJudge;
  }, [onJudge]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "v" || key === "м") {
        event.preventDefault();
        onJudgeRef.current("correct");
      } else if (key === "x" || key === "ч") {
        event.preventDefault();
        onJudgeRef.current("incorrect");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <Dialog
      closable={false}
      onClose={() => undefined}
      open
      title={`Отвечает ${playerName}`}
    >
      <p className="text-center text-sm text-slate-500">Оцените ответ игрока</p>
      <div className="mt-5 grid grid-cols-2 gap-4">
        <Button
          aria-label="Верно, клавиша V"
          className="min-h-36 flex-col gap-2 rounded-3xl bg-emerald-600 text-6xl hover:bg-emerald-500"
          onClick={() => {
            onJudge("correct");
          }}
        >
          <span aria-hidden>✓</span>
          <kbd className="text-xs font-semibold">V</kbd>
        </Button>
        <Button
          aria-label="Неверно, клавиша X"
          className="min-h-36 flex-col gap-2 rounded-3xl text-6xl"
          onClick={() => {
            onJudge("incorrect");
          }}
          variant="danger"
        >
          <span aria-hidden>✕</span>
          <kbd className="text-xs font-semibold">X</kbd>
        </Button>
      </div>
    </Dialog>
  );
}

const maximumScoreDelta = 1_000_000;

function clampScoreDelta(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-maximumScoreDelta, Math.min(maximumScoreDelta, value));
}

function formatScoreDelta(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function ScoreEditorDialog({
  cancelLabel,
  children,
  initialDelta,
  inputLabel,
  onCancel,
  onConfirm,
  title,
}: {
  cancelLabel: string;
  children?: ReactNode;
  initialDelta: number;
  inputLabel: string;
  onCancel: () => void;
  onConfirm: (delta: number) => void;
  title: (delta: number) => string;
}) {
  const [delta, setDelta] = useState(initialDelta);
  const deltaRef = useRef(delta);
  const onConfirmRef = useRef(onConfirm);

  useEffect(() => {
    deltaRef.current = delta;
  }, [delta]);

  useEffect(() => {
    onConfirmRef.current = onConfirm;
  }, [onConfirm]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      const key = event.key.toLowerCase();
      if (
        event.target instanceof HTMLInputElement &&
        event.target.type !== "number" &&
        key !== "enter"
      ) {
        return;
      }
      if (key === "arrowup") {
        event.preventDefault();
        setDelta((current) => clampScoreDelta(current + 100));
      } else if (key === "arrowdown") {
        event.preventDefault();
        setDelta((current) => clampScoreDelta(current - 100));
      } else if (key === "s" || key === "ы") {
        event.preventDefault();
        setDelta((current) => clampScoreDelta(-current));
      } else if (key === "0") {
        event.preventDefault();
        setDelta(0);
      } else if (key === "x" || key === "ч") {
        event.preventDefault();
        setDelta((current) => clampScoreDelta(current * 2));
      } else if (key === "enter") {
        event.preventDefault();
        onConfirmRef.current(deltaRef.current);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <Dialog
      closable={false}
      onClose={() => undefined}
      open
      title={title(delta)}
    >
      {children}
      <label className="mt-3 block max-w-xs">
        <Input
          aria-label={inputLabel}
          onChange={(event) => {
            setDelta(clampScoreDelta(event.target.valueAsNumber));
          }}
          step={100}
          type="number"
          value={delta}
        />
      </label>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Button
          aria-label="Сменить знак, клавиша S"
          onClick={() => {
            setDelta((current) => clampScoreDelta(-current));
          }}
          variant="secondary"
        >
          +/− <kbd className="ml-2 text-xs">S</kbd>
        </Button>
        <Button
          aria-label="Обнулить, клавиша 0"
          onClick={() => {
            setDelta(0);
          }}
          variant="secondary"
        >
          0 <kbd className="ml-2 text-xs">0</kbd>
        </Button>
        <Button
          aria-label="Умножить на два, клавиша X"
          onClick={() => {
            setDelta((current) => clampScoreDelta(current * 2));
          }}
          variant="secondary"
        >
          ×2 <kbd className="ml-2 text-xs">X</kbd>
        </Button>
      </div>
      <div className="mt-5 grid gap-2">
        <Button
          className="min-h-14 rounded-2xl text-xl"
          onClick={() => {
            onConfirm(delta);
          }}
        >
          Ок <kbd className="ml-3 text-xs">Enter</kbd>
        </Button>
        <Button onClick={onCancel} variant="secondary">
          {cancelLabel}
        </Button>
      </div>
    </Dialog>
  );
}

function ScoreConfirmation({
  onCancel,
  onConfirm,
  proposal,
}: {
  onCancel: () => void;
  onConfirm: (proposalId: string, delta: number) => void;
  proposal: ScoreChangeProposal;
}) {
  const isAllPlayersProposal = proposal.target === "all-players";

  return (
    <ScoreEditorDialog
      cancelLabel={isAllPlayersProposal ? "Отмена" : "Назад к оценке"}
      initialDelta={proposal.suggestedDelta}
      inputLabel={isAllPlayersProposal ? "Баллы каждому" : "Баллы"}
      onCancel={onCancel}
      onConfirm={(delta) => {
        onConfirm(proposal.id, delta);
      }}
      title={(delta) =>
        isAllPlayersProposal
          ? `Все игроки · ${formatScoreDelta(delta)} каждому`
          : `${proposal.playerName} · ${formatScoreDelta(delta)} баллов`
      }
    />
  );
}

function ManualScoreDialog({
  onCancel,
  onConfirm,
  player,
}: {
  onCancel: () => void;
  onConfirm: (name: string, delta: number) => void;
  player: HostPlayer;
}) {
  const [name, setName] = useState(player.name);
  const [nameError, setNameError] = useState<string | null>(null);

  return (
    <ScoreEditorDialog
      cancelLabel="Отмена"
      initialDelta={0}
      inputLabel="Баллы"
      onCancel={onCancel}
      onConfirm={(delta) => {
        const parsedName = roomNameSchema.safeParse(name);
        if (!parsedName.success) {
          setNameError(
            parsedName.error.issues[0]?.message ?? "Проверьте имя игрока",
          );
          return;
        }
        onConfirm(parsedName.data, delta);
      }}
      title={(delta) =>
        `${name || "Игрок"} · ${formatScoreDelta(delta)} баллов`
      }
    >
      <label className="block max-w-xs">
        <span className="mb-1 block text-sm font-semibold text-slate-700">
          Имя игрока
        </span>
        <Input
          aria-label="Имя игрока"
          autoFocus
          maxLength={PLAYER_NAME_MAX_LENGTH}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          value={name}
        />
      </label>
      {nameError === null ? null : (
        <ErrorMessage className="mt-2">{nameError}</ErrorMessage>
      )}
    </ScoreEditorDialog>
  );
}
