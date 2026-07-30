"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useEffect, useMemo, useRef, useState } from "react";

import { BottomProgress } from "@/components/bottom-progress";
import { Button } from "@/components/button";
import { ErrorMessage } from "@/components/error-message";
import { Input } from "@/components/input";
import { ScrollArea } from "@/components/scroll-area";
import { listQuizzes } from "@/shared/api/quizzes";
import { getQuizAssetUrl } from "@/shared/api/quizzes";
import { hostSessionStorageKey } from "@/shared/constants/storage";
import type {
  AnswerJudgement,
  CreateRoomResult,
  GameBoardTheme,
  HostRoomState,
  ScoreChangeProposal,
  SocketError,
} from "@/shared/contracts/socket";
import { hostSessionSchema } from "@/shared/schemas/socket";
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
      setError(getErrorMessage(socketError));
    });
    socket.connect();

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomCode]);

  const proposal = roomState?.game?.scoreProposal ?? null;

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
      "question:finish" | "score:cancel" | "session:finish" | "session:start",
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

  return (
    <main className="relative grid h-full grid-cols-1 gap-4 overflow-hidden bg-slate-950 p-4 text-white lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="flex min-h-0 flex-col rounded-2xl bg-slate-900 p-5">
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
        </header>

        {error === null ? null : (
          <ErrorMessage className="mt-3">{error}</ErrorMessage>
        )}

        <ScrollArea className="mt-4 flex-1">
          {game === null ? (
            <section className="grid gap-5 lg:grid-cols-2">
              <div>
                <h2 className="text-2xl font-semibold">Лобби</h2>
                <p className="mt-2 text-slate-300">
                  Подключите игроков и запустите сессию.
                </p>
                <Button
                  className="mt-5"
                  disabled={(roomState?.players.length ?? 0) === 0}
                  onClick={() => {
                    command("session:start");
                  }}
                >
                  Начать викторину
                </Button>
              </div>
              <PlayerList players={roomState?.players ?? []} />
            </section>
          ) : game.phase === "board" ? (
            <section>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-2xl font-semibold">
                  Раунд {game.currentRoundIndex + 1} из {game.roundCount}
                </h2>
              </div>
              <HostBoard board={game.board} onSelect={selectQuestion} />
            </section>
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
              <div className="mt-5 rounded-xl bg-slate-950/70 p-4">
                <p className="text-xs text-slate-400">Правильный ответ</p>
                <p className="mt-1 text-xl">{activeQuestion?.answer}</p>
                {activeQuestion?.hostComment === null ? null : (
                  <p className="mt-3 text-sm text-slate-300">
                    {activeQuestion?.hostComment}
                  </p>
                )}
              </div>

              {game.phase === "buzzing" ? (
                <div className="mt-5 flex flex-wrap gap-2">
                  <p className="w-full text-lg">Ждём нажатия игроков…</p>
                  {activeQuestion?.attemptedPlayerIds.length === 0 ? null : (
                    <p className="w-full text-sm text-slate-400">
                      Уже отвечали:{" "}
                      {activeQuestion?.attemptedPlayerIds
                        .map(
                          (playerId) =>
                            roomState?.players.find(
                              (player) => player.id === playerId,
                            )?.name,
                        )
                        .filter((name) => name !== undefined)
                        .join(", ")}
                    </p>
                  )}
                  <Button
                    onClick={() => {
                      command("question:finish");
                    }}
                    variant="secondary"
                  >
                    Никто не ответил — раскрыть ответ
                  </Button>
                  {roomState?.buzzer.closeReason === "expired" ? (
                    <Button onClick={reopenBuzzer}>
                      Повторить окно нажатия
                    </Button>
                  ) : null}
                </div>
              ) : game.phase === "answering" ? (
                <div className="mt-5">
                  <p className="text-lg">
                    Отвечает:{" "}
                    <strong>
                      {
                        roomState?.players.find(
                          (player) =>
                            player.id === activeQuestion?.currentPlayerId,
                        )?.name
                      }
                    </strong>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => judge("correct")}>Верно</Button>
                    <Button onClick={() => judge("incorrect")} variant="danger">
                      Неверно
                    </Button>
                    <Button
                      onClick={() => judge("timeout")}
                      variant="secondary"
                    >
                      Не успел
                    </Button>
                  </div>
                </div>
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

      <aside className="min-h-0 overflow-auto rounded-2xl bg-white p-4 text-slate-950">
        <h2 className="font-semibold">Подключение игроков</h2>
        <select
          aria-label="Адрес локальной сети"
          className="mt-3 min-h-11 w-full rounded-lg border border-slate-300 px-2"
          onChange={(event) => {
            setSelectedBaseUrl(event.target.value);
          }}
          value={selectedBaseUrl}
        >
          {session.applicationUrls.map((url) => (
            <option key={url} value={url}>
              {url}
            </option>
          ))}
        </select>
        {qrCode === null ? null : (
          <Image
            alt="QR-код для подключения к комнате"
            className="mx-auto mt-3"
            height={220}
            priority
            src={qrCode}
            unoptimized
            width={220}
          />
        )}
        {joinUrl === null ? null : (
          <a
            className="mt-2 block text-center text-xs break-all text-blue-700 underline"
            href={joinUrl}
          >
            {joinUrl}
          </a>
        )}
        <NetworkDiagnostics
          applicationUrls={session.applicationUrls}
          connected={connected}
          joinUrl={joinUrl}
          roomState={roomState}
          selectedBaseUrl={selectedBaseUrl}
        />
        <div className="mt-4">
          <PlayerList players={roomState?.players ?? []} />
        </div>
      </aside>

      <BottomProgress timer={game?.timer ?? roomState?.buzzer.timer ?? null} />
    </main>
  );
}

function NetworkDiagnostics({
  applicationUrls,
  connected,
  joinUrl,
  roomState,
  selectedBaseUrl,
}: {
  applicationUrls: string[];
  connected: boolean;
  joinUrl: string | null;
  roomState: HostRoomState | null;
  selectedBaseUrl: string;
}) {
  const selectedUrl = selectedBaseUrl === "" ? null : new URL(selectedBaseUrl);
  const localAddresses = applicationUrls
    .map((url) => new URL(url).hostname)
    .filter((hostname) => hostname !== "localhost" && hostname !== "127.0.0.1");

  return (
    <section className="mt-5 rounded-xl border border-slate-300 bg-slate-50 p-3">
      <h3 className="font-semibold">Диагностика сети</h3>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Socket.IO</dt>
        <dd className={connected ? "text-emerald-700" : "text-red-700"}>
          {connected ? "подключён" : "нет соединения"}
        </dd>
        <dt className="text-slate-500">Клиентов</dt>
        <dd>{roomState?.connectedClientCount ?? 0}</dd>
        <dt className="text-slate-500">Display</dt>
        <dd>{roomState?.connectedDisplayCount ?? 0}</dd>
        <dt className="text-slate-500">Интерфейс</dt>
        <dd className="break-all">{selectedUrl?.hostname ?? "не выбран"}</dd>
        <dt className="text-slate-500">Порт</dt>
        <dd>{selectedUrl?.port || "80"}</dd>
        <dt className="text-slate-500">Локальные IPv4</dt>
        <dd className="break-all">
          {localAddresses.length === 0
            ? "не найдены"
            : localAddresses.join(", ")}
        </dd>
        <dt className="text-slate-500">Адрес игрока</dt>
        <dd className="break-all">{joinUrl ?? "формируется"}</dd>
      </dl>
      <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-slate-600">
        <li>Все устройства должны находиться в одной Wi-Fi или LAN-сети.</li>
        <li>На телефонах отключите мобильный интернет и VPN.</li>
        <li>Проверьте client isolation и изоляцию гостей на роутере.</li>
        <li>Разрешите входящие подключения в firewall компьютера ведущего.</li>
      </ul>
    </section>
  );
}

function HostBoard({
  board,
  onSelect,
}: {
  board: GameBoardTheme[];
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
          <h3 className="grid min-h-16 place-items-center rounded-lg bg-slate-800 p-3 text-center font-semibold">
            {theme.title}
          </h3>
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

function PlayerList({ players }: { players: HostRoomState["players"] }) {
  return (
    <div>
      <h3 className="font-semibold">Игроки ({players.length})</h3>
      <ul className="mt-2 space-y-2">
        {players.length === 0 ? (
          <li className="text-sm text-slate-500">Пока никого</li>
        ) : (
          players.map((player) => (
            <li
              className="flex justify-between gap-3 rounded-lg bg-slate-200 px-3 py-2 text-slate-950"
              key={player.id}
            >
              <span>{player.name}</span>
              <strong>{player.score}</strong>
            </li>
          ))
        )}
      </ul>
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

function ScoreConfirmation({
  onCancel,
  onConfirm,
  proposal,
}: {
  onCancel: () => void;
  onConfirm: (proposalId: string, delta: number) => void;
  proposal: ScoreChangeProposal;
}) {
  const [delta, setDelta] = useState(proposal.suggestedDelta);

  return (
    <div className="mt-5 rounded-xl border border-blue-500 p-4">
      <h3 className="text-xl font-semibold">
        Подтверждение баллов: {proposal.playerName}
      </h3>
      <p className="mt-1 text-slate-300">
        Стоимость {proposal.questionPrice}; результат:{" "}
        {proposal.judgement === "correct"
          ? "верно"
          : proposal.judgement === "incorrect"
            ? "неверно"
            : "не успел"}
      </p>
      <label className="mt-3 block max-w-xs">
        <span className="mb-1 block text-sm">Изменение баллов</span>
        <Input
          aria-label="Изменение баллов"
          onChange={(event) => {
            setDelta(Number(event.target.value));
          }}
          step={1}
          type="number"
          value={delta}
        />
      </label>
      <div className="mt-3 flex gap-2">
        <Button
          onClick={() => {
            onConfirm(proposal.id, delta);
          }}
        >
          Подтвердить
        </Button>
        <Button onClick={onCancel} variant="secondary">
          Отмена
        </Button>
      </div>
    </div>
  );
}
