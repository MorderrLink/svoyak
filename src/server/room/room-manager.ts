import { randomInt, randomUUID } from "node:crypto";

import { RoomError } from "@/server/room/room-error";
import type {
  BuzzerWindowRecord,
  PlayerRecord,
  RoomRecord,
} from "@/server/room/types";
import { GameSession } from "@/server/session/game-session";
import type {
  HostRoomState,
  AnswerJudgement,
  PlayerBuzzerStatus,
  PlayerScreenState,
  PublicPlayer,
  PublicRoomState,
  TimerState,
} from "@/shared/contracts/socket";
import type { QuizConfig } from "@/shared/types/quiz";

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCodeLength = 4;
const maxCodeGenerationAttempts = 100;

export interface RoomManagerOptions {
  codeGenerator?: () => string;
  idGenerator?: () => string;
  now?: () => number;
  tokenGenerator?: () => string;
}

export interface CreatedRoom {
  hostToken: string;
  roomCode: string;
}

export interface AddedPlayer {
  playerId: string;
  playerToken: string;
  previousSocketId: string | null;
}

export interface ReconnectedPlayer {
  playerId: string;
  previousSocketId: string | null;
}

export interface AttachedHost {
  previousSocketId: string | null;
}

export interface OpenedBuzzer {
  buzzWindowId: string;
  timer: TimerState;
}

function createRoomCode(): string {
  let code = "";

  for (let index = 0; index < roomCodeLength; index += 1) {
    code += roomCodeAlphabet[randomInt(roomCodeAlphabet.length)];
  }

  return code;
}

function toPublicPlayer(player: PlayerRecord): PublicPlayer {
  return {
    connected: player.connected,
    id: player.id,
    name: player.name,
    score: player.score,
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly codeGenerator: () => string;
  private readonly idGenerator: () => string;
  private readonly now: () => number;
  private readonly tokenGenerator: () => string;

  constructor(options: RoomManagerOptions = {}) {
    this.codeGenerator = options.codeGenerator ?? createRoomCode;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.now = options.now ?? Date.now;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
  }

  createRoom(quizSnapshot: QuizConfig | null = null): CreatedRoom {
    const roomCode = this.generateUniqueRoomCode();
    const hostToken = this.tokenGenerator();
    const timestamp = this.now();

    this.rooms.set(roomCode, {
      buzzer: null,
      code: roomCode,
      createdAt: timestamp,
      hostSocketId: null,
      hostToken,
      lastActivityAt: timestamp,
      players: new Map(),
      quizSnapshot:
        quizSnapshot === null ? null : structuredClone(quizSnapshot),
      session: null,
    });

    return {
      hostToken,
      roomCode,
    };
  }

  generateUniqueRoomCode(): string {
    for (let attempt = 0; attempt < maxCodeGenerationAttempts; attempt += 1) {
      const code = this.codeGenerator();

      if (!this.rooms.has(code)) {
        return code;
      }
    }

    throw new Error("Не удалось сгенерировать уникальный код комнаты");
  }

  hasRoom(roomCode: string): boolean {
    return this.rooms.has(roomCode);
  }

  getRoom(roomCode: string): RoomRecord | undefined {
    return this.rooms.get(roomCode);
  }

  requireRoom(roomCode: string): RoomRecord {
    const room = this.rooms.get(roomCode);

    if (room === undefined) {
      throw new RoomError("ROOM_NOT_FOUND", "Комната не найдена");
    }

    return room;
  }

  attachHost(
    roomCode: string,
    hostToken: string,
    socketId: string,
  ): AttachedHost {
    const room = this.requireHost(roomCode, hostToken);
    const previousSocketId = room.hostSocketId;

    room.hostSocketId = socketId;
    this.touch(room);

    return {
      previousSocketId,
    };
  }

  disconnectHost(roomCode: string, socketId: string): void {
    const room = this.rooms.get(roomCode);

    if (room?.hostSocketId === socketId) {
      room.hostSocketId = null;
      this.touch(room);
    }
  }

  addPlayer(roomCode: string, name: string, socketId: string): AddedPlayer {
    const room = this.requireRoom(roomCode);
    const normalizedName = name.trim().toLocaleLowerCase("ru-RU");
    const nameIsTaken = [...room.players.values()].some(
      (player) =>
        player.name.trim().toLocaleLowerCase("ru-RU") === normalizedName,
    );

    if (nameIsTaken) {
      throw new RoomError("NAME_TAKEN", "Игрок с таким именем уже подключён");
    }

    const playerId = this.idGenerator();
    const playerToken = this.tokenGenerator();

    room.players.set(playerId, {
      connected: true,
      id: playerId,
      name: name.trim(),
      score: 0,
      socketId,
      token: playerToken,
    });
    this.touch(room);

    return {
      playerId,
      playerToken,
      previousSocketId: null,
    };
  }

  reconnectPlayer(
    roomCode: string,
    playerToken: string,
    socketId: string,
  ): ReconnectedPlayer {
    const room = this.requireRoom(roomCode);
    const player = this.findPlayerByToken(room, playerToken);
    const previousSocketId = player.socketId;

    player.connected = true;
    player.socketId = socketId;
    this.touch(room);

    return {
      playerId: player.id,
      previousSocketId,
    };
  }

  disconnectPlayer(roomCode: string, playerId: string, socketId: string): void {
    const room = this.rooms.get(roomCode);
    const player = room?.players.get(playerId);

    if (room !== undefined && player?.socketId === socketId) {
      player.connected = false;
      player.socketId = null;
      this.touch(room);
    }
  }

  removePlayer(roomCode: string, playerId: string): boolean {
    const room = this.requireRoom(roomCode);
    const removed = room.players.delete(playerId);

    if (removed) {
      this.touch(room);
    }

    return removed;
  }

  openBuzzer(
    roomCode: string,
    hostToken: string,
    durationMs: number,
  ): OpenedBuzzer {
    const room = this.requireHost(roomCode, hostToken);
    const gameDurationMs =
      room.session?.getPhase() === "buzzing"
        ? (room.quizSnapshot?.settings.buzzSeconds ?? durationMs / 1_000) *
          1_000
        : durationMs;
    const opened = this.openBuzzerRecord(room, gameDurationMs);
    if (room.session?.getPhase() === "buzzing") {
      room.session.setBuzzTimer(opened.timer);
    }
    this.touch(room);

    return opened;
  }

  closeBuzzer(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);

    if (room.buzzer !== null) {
      room.buzzer.status = "closed";
      room.buzzer.closeReason = "manual";
    }

    this.touch(room);
  }

  resetBuzzer(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);
    room.buzzer = null;
    this.touch(room);
  }

  expireBuzzer(roomCode: string, buzzWindowId: string): boolean {
    const room = this.rooms.get(roomCode);
    const buzzer = room?.buzzer;

    if (
      room === undefined ||
      buzzer === null ||
      buzzer === undefined ||
      buzzer.id !== buzzWindowId ||
      buzzer.status !== "open" ||
      this.now() < buzzer.timer.endsAt
    ) {
      return false;
    }

    buzzer.status = "closed";
    buzzer.closeReason = "expired";
    this.touch(room);
    return true;
  }

  pressBuzzer(
    roomCode: string,
    playerToken: string,
    buzzWindowId: string,
  ): void {
    const room = this.requireRoom(roomCode);
    const player = this.findPlayerByToken(room, playerToken);
    const buzzer = room.buzzer;

    if (room.session?.getAttemptedPlayerIds().has(player.id)) {
      throw new RoomError(
        "BUZZ_ALREADY_PRESSED",
        "Игрок уже отвечал на текущий вопрос",
      );
    }

    if (buzzer === null) {
      throw new RoomError("BUZZER_CLOSED", "Кнопки сейчас закрыты");
    }

    if (buzzer.id !== buzzWindowId) {
      throw new RoomError(
        "BUZZ_WINDOW_MISMATCH",
        "Это окно нажатия уже неактуально",
      );
    }

    if (this.now() > buzzer.timer.endsAt) {
      buzzer.status = "closed";
      buzzer.closeReason = "expired";
      throw new RoomError(
        "BUZZ_WINDOW_EXPIRED",
        "Время на нажатие закончилось",
      );
    }

    if (buzzer.pressedPlayerIds.has(player.id)) {
      throw new RoomError(
        "BUZZ_ALREADY_PRESSED",
        "Нажатие этого игрока уже обработано",
      );
    }

    if (buzzer.winnerPlayerId !== null || buzzer.status === "winner") {
      throw new RoomError("BUZZ_ALREADY_WON", "Первый игрок уже определён");
    }

    if (buzzer.status !== "open") {
      throw new RoomError("BUZZER_CLOSED", "Кнопки сейчас закрыты");
    }

    buzzer.pressedPlayerIds.add(player.id);
    buzzer.winnerPlayerId = player.id;
    buzzer.status = "winner";
    if (room.session?.getPhase() === "buzzing") {
      room.session.beginAnswer(player.id);
    }
    this.touch(room);
  }

  startSession(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);

    if (room.quizSnapshot === null) {
      throw new RoomError("QUIZ_NOT_FOUND", "Викторина комнаты не найдена");
    }

    room.session = new GameSession(
      room.quizSnapshot,
      this.now,
      this.idGenerator,
    );
    room.buzzer = null;
    this.touch(room);
  }

  selectQuestion(
    roomCode: string,
    hostToken: string,
    questionId: string,
  ): TimerState {
    const room = this.requireHost(roomCode, hostToken);
    const timer = this.requireSession(room).selectQuestion(questionId);
    room.buzzer = null;
    this.touch(room);
    return timer;
  }

  completeQuestionIntro(roomCode: string): OpenedBuzzer {
    const room = this.requireRoom(roomCode);
    const session = this.requireSession(room);
    session.completeQuestionIntro();
    const durationMs = (room.quizSnapshot?.settings.buzzSeconds ?? 10) * 1_000;
    const opened = this.openBuzzerRecord(room, durationMs);
    session.setBuzzTimer(opened.timer);
    this.touch(room);
    return opened;
  }

  judgeAnswer(
    roomCode: string,
    hostToken: string,
    judgement: AnswerJudgement,
  ): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).judgeAnswer(judgement, room.players);
    this.touch(room);
  }

  cancelScoreProposal(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).cancelScoreProposal();
    this.touch(room);
  }

  confirmScore(
    roomCode: string,
    hostToken: string,
    proposalId: string,
    delta: number,
  ): "answer-reveal" | "buzzing" {
    const room = this.requireHost(roomCode, hostToken);
    const session = this.requireSession(room);
    const outcome = session.confirmScore(proposalId, delta, room.players);

    if (outcome === "buzzing") {
      const durationMs =
        (room.quizSnapshot?.settings.buzzSeconds ?? 10) * 1_000;
      const opened = this.openBuzzerRecord(room, durationMs);
      session.setBuzzTimer(opened.timer);
    } else {
      room.buzzer = null;
    }

    this.touch(room);
    return outcome;
  }

  revealAnswer(roomCode: string, hostToken: string): TimerState {
    const room = this.requireHost(roomCode, hostToken);
    room.buzzer = null;
    const timer = this.requireSession(room).revealAnswer();
    this.touch(room);
    return timer;
  }

  finishQuestion(roomCode: string): void {
    const room = this.requireRoom(roomCode);
    this.requireSession(room).finishQuestion();
    room.buzzer = null;
    this.touch(room);
  }

  finishSession(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).finishSession();
    room.buzzer = null;
    this.touch(room);
  }

  getHostState(roomCode: string): HostRoomState {
    const room = this.requireRoom(roomCode);
    const buzzer = room.buzzer;
    const winner =
      buzzer?.winnerPlayerId === null || buzzer?.winnerPlayerId === undefined
        ? null
        : room.players.get(buzzer.winnerPlayerId);

    return {
      buzzer: {
        closeReason: buzzer?.closeReason ?? null,
        status: buzzer?.status ?? "closed",
        timer: buzzer?.status === "open" ? buzzer.timer : null,
        windowId: buzzer?.id ?? null,
        winner:
          winner === null || winner === undefined
            ? null
            : {
                id: winner.id,
                name: winner.name,
              },
      },
      game: room.session?.getState() ?? null,
      players: [...room.players.values()]
        .map(toPublicPlayer)
        .sort((left, right) =>
          room.session?.getPhase() === "game-finished"
            ? right.score - left.score || left.name.localeCompare(right.name)
            : 0,
        ),
      quizTitle: room.quizSnapshot?.title ?? null,
      roomCode: room.code,
    };
  }

  getPlayerState(roomCode: string, playerId: string): PlayerScreenState {
    const room = this.requireRoom(roomCode);
    const player = room.players.get(playerId);

    if (player === undefined) {
      throw new RoomError("PLAYER_UNAUTHORIZED", "Игрок не найден");
    }

    return {
      buzzer: {
        status: this.getPlayerBuzzerStatus(room, playerId),
        timer: room.buzzer?.status === "open" ? room.buzzer.timer : null,
        windowId: room.buzzer?.id ?? null,
      },
      connected: player.connected,
      name: player.name,
      playerId: player.id,
      phase: room.session?.getPhase() ?? null,
      roomCode: room.code,
      score: player.score,
      showScore: room.quizSnapshot?.settings.showScoresToPlayers ?? true,
    };
  }

  getPublicRoomState(roomCode: string): PublicRoomState {
    const room = this.requireRoom(roomCode);

    return {
      buzzerStatus: room.buzzer?.status ?? "closed",
      connectedPlayerCount: [...room.players.values()].filter(
        (player) => player.connected,
      ).length,
      roomCode: room.code,
    };
  }

  deleteInactiveRooms(maxIdleMs: number): string[] {
    const now = this.now();
    const deletedRoomCodes: string[] = [];

    for (const [roomCode, room] of this.rooms) {
      const hasConnectedPlayer = [...room.players.values()].some(
        (player) => player.connected,
      );

      if (
        room.hostSocketId === null &&
        !hasConnectedPlayer &&
        now - room.lastActivityAt >= maxIdleMs
      ) {
        this.rooms.delete(roomCode);
        deletedRoomCodes.push(roomCode);
      }
    }

    return deletedRoomCodes;
  }

  private requireHost(roomCode: string, hostToken: string): RoomRecord {
    const room = this.requireRoom(roomCode);

    if (room.hostToken !== hostToken) {
      throw new RoomError("HOST_UNAUTHORIZED", "Нет доступа к комнате");
    }

    return room;
  }

  private findPlayerByToken(
    room: RoomRecord,
    playerToken: string,
  ): PlayerRecord {
    const player = [...room.players.values()].find(
      (candidate) => candidate.token === playerToken,
    );

    if (player === undefined) {
      throw new RoomError(
        "PLAYER_UNAUTHORIZED",
        "Не удалось восстановить игрока",
      );
    }

    return player;
  }

  private getPlayerBuzzerStatus(
    room: RoomRecord,
    playerId: string,
  ): PlayerBuzzerStatus {
    const { buzzer } = room;

    if (room.session?.getAttemptedPlayerIds().has(playerId)) {
      return "answered-incorrectly";
    }

    if (buzzer === null) {
      return "waiting";
    }

    if (buzzer.closeReason === "expired") {
      return "time-expired";
    }

    if (buzzer.status === "open") {
      return "ready";
    }

    if (buzzer.status === "winner") {
      return buzzer.winnerPlayerId === playerId
        ? "winner"
        : "other-player-answering";
    }

    return "waiting";
  }

  private touch(room: RoomRecord): void {
    room.lastActivityAt = this.now();
  }

  private requireSession(room: RoomRecord): GameSession {
    if (room.session === null) {
      throw new RoomError(
        "SESSION_NOT_STARTED",
        "Игровая сессия ещё не запущена",
      );
    }

    return room.session;
  }

  private openBuzzerRecord(room: RoomRecord, durationMs: number): OpenedBuzzer {
    const startedAt = this.now();
    const timer: TimerState = {
      durationMs,
      endsAt: startedAt + durationMs,
      startedAt,
    };
    const buzzer: BuzzerWindowRecord = {
      closeReason: null,
      id: this.idGenerator(),
      pressedPlayerIds: new Set(),
      status: "open",
      timer,
      winnerPlayerId: null,
    };

    room.buzzer = buzzer;
    return {
      buzzWindowId: buzzer.id,
      timer,
    };
  }
}
