import { QuizRepositoryError } from "@/server/quiz/quiz-repository-error";
import { getQuizRepository } from "@/server/quiz/quiz-repository-instance";
import { RoomError } from "@/server/room/room-error";
import type { RoomManager } from "@/server/room/room-manager";
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
  SocketError,
  SocketResult,
} from "@/shared/contracts/socket";
import {
  checkRoomPayloadSchema,
  confirmScorePayloadSchema,
  createRoomPayloadSchema,
  hostCommandPayloadSchema,
  judgeAnswerPayloadSchema,
  joinRoomPayloadSchema,
  openBuzzerPayloadSchema,
  pressBuzzerPayloadSchema,
  reconnectHostPayloadSchema,
  reconnectPlayerPayloadSchema,
  selectQuestionPayloadSchema,
} from "@/shared/schemas/socket";

import type { Server, Socket } from "socket.io";
import type { ZodType } from "zod";

type ApplicationSocketServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

type ApplicationSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface SocketHandlerOptions {
  applicationUrls: string[];
  inactiveRoomLifetimeMs?: number;
}

interface ParsedPayload<T> {
  data: T;
  success: true;
}

interface InvalidPayload {
  error: SocketError;
  success: false;
}

const defaultInactiveRoomLifetimeMs = 30 * 60 * 1_000;
const cleanupIntervalMs = 60_000;

function success<T>(data: T): SocketResult<T> {
  return {
    data,
    ok: true,
  };
}

function failure(error: SocketError): SocketResult<never> {
  return {
    error,
    ok: false,
  };
}

function toSocketError(error: unknown): SocketError {
  if (error instanceof RoomError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof QuizRepositoryError && error.code === "QUIZ_NOT_FOUND") {
    return {
      code: "QUIZ_NOT_FOUND",
      message: error.message,
    };
  }

  console.error("Необработанная ошибка Socket.IO:", error);
  return {
    code: "INTERNAL_ERROR",
    message: "Внутренняя ошибка сервера",
  };
}

function parsePayload<T>(
  schema: ZodType<T>,
  payload: unknown,
): InvalidPayload | ParsedPayload<T> {
  const result = schema.safeParse(payload);

  if (!result.success) {
    return {
      error: {
        code: "INVALID_PAYLOAD",
        message: result.error.issues[0]?.message ?? "Некорректные данные",
      },
      success: false,
    };
  }

  return {
    data: result.data,
    success: true,
  };
}

function respondWithError<T>(
  socket: ApplicationSocket,
  callback: ((result: SocketResult<T>) => void) | undefined,
  error: SocketError,
): void {
  if (typeof callback === "function") {
    callback(failure(error));
  } else {
    socket.emit("error", error);
  }
}

function respondWithSuccess<T>(
  socket: ApplicationSocket,
  callback: ((result: SocketResult<T>) => void) | undefined,
  data: T,
): void {
  if (typeof callback === "function") {
    callback(success(data));
  } else {
    socket.emit("error", {
      code: "INVALID_PAYLOAD",
      message: "Для команды требуется callback подтверждения",
    });
  }
}

function emitRoomState(
  io: ApplicationSocketServer,
  roomManager: RoomManager,
  roomCode: string,
): void {
  const room = roomManager.getRoom(roomCode);

  if (room === undefined) {
    return;
  }

  if (room.hostSocketId !== null) {
    io.to(room.hostSocketId).emit(
      "host:state",
      roomManager.getHostState(roomCode),
    );
  }

  for (const player of room.players.values()) {
    if (player.socketId !== null) {
      io.to(player.socketId).emit(
        "player:state",
        roomManager.getPlayerState(roomCode, player.id),
      );
    }
  }
}

function disconnectPreviousSocket(
  io: ApplicationSocketServer,
  previousSocketId: string | null,
  currentSocketId: string,
): void {
  if (previousSocketId !== null && previousSocketId !== currentSocketId) {
    io.sockets.sockets.get(previousSocketId)?.disconnect(true);
  }
}

export function registerSocketHandlers(
  io: ApplicationSocketServer,
  roomManager: RoomManager,
  options: SocketHandlerOptions,
): () => void {
  const expirationTimers = new Map<string, NodeJS.Timeout>();
  const inactiveRoomLifetimeMs =
    options.inactiveRoomLifetimeMs ?? defaultInactiveRoomLifetimeMs;
  const quizRepository = getQuizRepository();

  const clearExpirationTimer = (roomCode: string) => {
    const timer = expirationTimers.get(roomCode);

    if (timer !== undefined) {
      clearTimeout(timer);
      expirationTimers.delete(roomCode);
    }
  };

  const scheduleExpiration = (
    roomCode: string,
    buzzWindowId: string,
    durationMs: number,
  ) => {
    clearExpirationTimer(roomCode);

    const timer = setTimeout(() => {
      expirationTimers.delete(roomCode);

      if (roomManager.expireBuzzer(roomCode, buzzWindowId)) {
        emitRoomState(io, roomManager, roomCode);
      }
    }, durationMs);

    expirationTimers.set(roomCode, timer);
  };

  const scheduleGameTransition = (
    roomCode: string,
    phase: "answer-reveal" | "question-intro",
    endsAt: number,
  ) => {
    clearExpirationTimer(roomCode);

    const timer = setTimeout(
      () => {
        expirationTimers.delete(roomCode);

        try {
          if (phase === "question-intro") {
            const opened = roomManager.completeQuestionIntro(roomCode);
            emitRoomState(io, roomManager, roomCode);
            scheduleExpiration(
              roomCode,
              opened.buzzWindowId,
              Math.max(0, opened.timer.endsAt - Date.now()),
            );
          } else {
            roomManager.finishQuestion(roomCode);
            emitRoomState(io, roomManager, roomCode);
          }
        } catch (error: unknown) {
          console.error("Ошибка автоматического перехода игры:", error);
        }
      },
      Math.max(0, endsAt - Date.now()),
    );

    expirationTimers.set(roomCode, timer);
  };

  io.on("connection", (socket) => {
    socket.on("room:check", (payload, callback) => {
      const parsed = parsePayload(checkRoomPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      respondWithSuccess(socket, callback, {
        exists: roomManager.hasRoom(parsed.data.roomCode),
        roomCode: parsed.data.roomCode,
      });
    });

    socket.on("room:create", (payload, callback) => {
      const parsed = parsePayload(createRoomPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      void quizRepository
        .get(parsed.data.quizId)
        .then((quiz) => {
          const created = roomManager.createRoom(quiz);
          roomManager.attachHost(
            created.roomCode,
            created.hostToken,
            socket.id,
          );
          socket.data = {
            role: "host",
            roomCode: created.roomCode,
          };

          respondWithSuccess(socket, callback, {
            applicationUrls: options.applicationUrls,
            hostToken: created.hostToken,
            quizTitle: quiz.title,
            roomCode: created.roomCode,
          });
          emitRoomState(io, roomManager, created.roomCode);
        })
        .catch((error: unknown) => {
          respondWithError(socket, callback, toSocketError(error));
        });
    });

    socket.on("host:reconnect", (payload, callback) => {
      const parsed = parsePayload(reconnectHostPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        const attached = roomManager.attachHost(
          parsed.data.roomCode,
          parsed.data.hostToken,
          socket.id,
        );
        socket.data = {
          role: "host",
          roomCode: parsed.data.roomCode,
        };
        disconnectPreviousSocket(io, attached.previousSocketId, socket.id);
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("room:join", (payload, callback) => {
      const parsed = parsePayload(joinRoomPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        const added = roomManager.addPlayer(
          parsed.data.roomCode,
          parsed.data.name,
          socket.id,
        );
        socket.data = {
          playerId: added.playerId,
          role: "player",
          roomCode: parsed.data.roomCode,
        };

        respondWithSuccess(socket, callback, {
          playerId: added.playerId,
          playerToken: added.playerToken,
          roomCode: parsed.data.roomCode,
        });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("player:reconnect", (payload, callback) => {
      const parsed = parsePayload(reconnectPlayerPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        const reconnected = roomManager.reconnectPlayer(
          parsed.data.roomCode,
          parsed.data.playerToken,
          socket.id,
        );
        socket.data = {
          playerId: reconnected.playerId,
          role: "player",
          roomCode: parsed.data.roomCode,
        };
        disconnectPreviousSocket(io, reconnected.previousSocketId, socket.id);
        respondWithSuccess(socket, callback, {
          playerId: reconnected.playerId,
          roomCode: parsed.data.roomCode,
        });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("buzzer:open", (payload, callback) => {
      const parsed = parsePayload(openBuzzerPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        const opened = roomManager.openBuzzer(
          parsed.data.roomCode,
          parsed.data.hostToken,
          parsed.data.durationMs,
        );
        scheduleExpiration(
          parsed.data.roomCode,
          opened.buzzWindowId,
          opened.timer.durationMs,
        );
        respondWithSuccess(socket, callback, opened);
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("buzzer:close", (payload, callback) => {
      const parsed = parsePayload(hostCommandPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        roomManager.closeBuzzer(parsed.data.roomCode, parsed.data.hostToken);
        clearExpirationTimer(parsed.data.roomCode);
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("buzzer:reset", (payload, callback) => {
      const parsed = parsePayload(hostCommandPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        roomManager.resetBuzzer(parsed.data.roomCode, parsed.data.hostToken);
        clearExpirationTimer(parsed.data.roomCode);
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("buzzer:press", (payload, callback) => {
      const parsed = parsePayload(pressBuzzerPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        roomManager.pressBuzzer(
          parsed.data.roomCode,
          parsed.data.playerToken,
          parsed.data.buzzWindowId,
        );
        clearExpirationTimer(parsed.data.roomCode);
        respondWithSuccess(socket, callback, { accepted: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
        emitRoomState(io, roomManager, parsed.data.roomCode);
      }
    });

    socket.on("session:start", (payload, callback) => {
      const parsed = parsePayload(hostCommandPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        roomManager.startSession(parsed.data.roomCode, parsed.data.hostToken);
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("question:select", (payload, callback) => {
      const parsed = parsePayload(selectQuestionPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        const timer = roomManager.selectQuestion(
          parsed.data.roomCode,
          parsed.data.hostToken,
          parsed.data.questionId,
        );
        scheduleGameTransition(
          parsed.data.roomCode,
          "question-intro",
          timer.endsAt,
        );
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("answer:judge", (payload, callback) => {
      const parsed = parsePayload(judgeAnswerPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        roomManager.judgeAnswer(
          parsed.data.roomCode,
          parsed.data.hostToken,
          parsed.data.judgement,
        );
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("score:cancel", (payload, callback) => {
      const parsed = parsePayload(hostCommandPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        roomManager.cancelScoreProposal(
          parsed.data.roomCode,
          parsed.data.hostToken,
        );
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("score:confirm", (payload, callback) => {
      const parsed = parsePayload(confirmScorePayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        const outcome = roomManager.confirmScore(
          parsed.data.roomCode,
          parsed.data.hostToken,
          parsed.data.proposalId,
          parsed.data.delta,
        );
        const room = roomManager.requireRoom(parsed.data.roomCode);

        if (outcome === "buzzing" && room.buzzer !== null) {
          scheduleExpiration(
            parsed.data.roomCode,
            room.buzzer.id,
            Math.max(0, room.buzzer.timer.endsAt - Date.now()),
          );
        } else if (room.session?.getTimer() !== null) {
          scheduleGameTransition(
            parsed.data.roomCode,
            "answer-reveal",
            room.session?.getTimer()?.endsAt ?? Date.now(),
          );
        }

        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("question:finish", (payload, callback) => {
      const parsed = parsePayload(hostCommandPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        const timer = roomManager.revealAnswer(
          parsed.data.roomCode,
          parsed.data.hostToken,
        );
        scheduleGameTransition(
          parsed.data.roomCode,
          "answer-reveal",
          timer.endsAt,
        );
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("session:finish", (payload, callback) => {
      const parsed = parsePayload(hostCommandPayloadSchema, payload);

      if (!parsed.success) {
        respondWithError(socket, callback, parsed.error);
        return;
      }

      try {
        roomManager.finishSession(parsed.data.roomCode, parsed.data.hostToken);
        clearExpirationTimer(parsed.data.roomCode);
        respondWithSuccess(socket, callback, { completed: true });
        emitRoomState(io, roomManager, parsed.data.roomCode);
      } catch (error: unknown) {
        respondWithError(socket, callback, toSocketError(error));
      }
    });

    socket.on("disconnect", () => {
      const { playerId, role, roomCode } = socket.data;

      if (roomCode === undefined || role === undefined) {
        return;
      }

      if (role === "host") {
        roomManager.disconnectHost(roomCode, socket.id);
      } else if (playerId !== undefined) {
        roomManager.disconnectPlayer(roomCode, playerId, socket.id);
      }

      emitRoomState(io, roomManager, roomCode);
    });
  });

  const cleanupTimer = setInterval(() => {
    for (const roomCode of roomManager.deleteInactiveRooms(
      inactiveRoomLifetimeMs,
    )) {
      clearExpirationTimer(roomCode);
    }
  }, cleanupIntervalMs);

  return () => {
    clearInterval(cleanupTimer);

    for (const timer of expirationTimers.values()) {
      clearTimeout(timer);
    }
    expirationTimers.clear();
  };
}
