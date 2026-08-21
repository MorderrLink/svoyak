import {
  createHash,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import { RoomError } from "@/server/room/room-error";
import type {
  BuzzerWindowRecord,
  PlayerRecord,
  RoomRecord,
} from "@/server/room/types";
import { GameSession } from "@/server/session/game-session";
import type {
  SessionEventInput,
  SessionEventWriter,
} from "@/server/session/session-event-journal";
import type {
  HostRoomState,
  AnswerJudgement,
  DisplayRoomState,
  HostPlayer,
  PlayerBuzzerStatus,
  PlayerScreenState,
  PublicPlayer,
  PublicRoomState,
  TimerState,
} from "@/shared/contracts/socket";
import { roomNameSchema } from "@/shared/schemas/socket";
import type { QuizConfig } from "@/shared/types/quiz";

const roomCodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const roomCodeLength = 4;
const maxCodeGenerationAttempts = 100;

export interface RoomManagerOptions {
  codeGenerator?: () => string;
  idGenerator?: () => string;
  journal?: SessionEventWriter;
  now?: () => number;
  random?: () => number;
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

export interface SelectedQuestion {
  buzzer: OpenedBuzzer | null;
  timer: TimerState | null;
}

export interface PlayerConnectionMetadata {
  device: string;
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

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return (
    actual.byteLength === expected.byteLength &&
    timingSafeEqual(actual, expected)
  );
}

function parsePlayerName(name: string): string {
  const parsed = roomNameSchema.safeParse(name);
  if (!parsed.success) {
    throw new RoomError(
      "INVALID_PAYLOAD",
      parsed.error.issues[0]?.message ?? "Некорректное имя игрока",
    );
  }
  return parsed.data;
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly codeGenerator: () => string;
  private readonly idGenerator: () => string;
  private readonly journal: SessionEventWriter | undefined;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly tokenGenerator: () => string;

  constructor(options: RoomManagerOptions = {}) {
    this.codeGenerator = options.codeGenerator ?? createRoomCode;
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.journal = options.journal;
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.tokenGenerator = options.tokenGenerator ?? randomUUID;
  }

  createRoom(quizSnapshot: QuizConfig | null = null): CreatedRoom {
    const roomCode = this.generateUniqueRoomCode();
    const hostToken = this.tokenGenerator();
    const timestamp = this.now();

    this.rooms.set(roomCode, {
      buzzer: null,
      code: roomCode,
      displaySocketIds: new Set(),
      hostSocketId: null,
      hostTokenHash: hashToken(hostToken),
      lastActivityAt: timestamp,
      players: new Map(),
      quizSnapshot:
        quizSnapshot === null ? null : structuredClone(quizSnapshot),
      session: null,
    });
    this.recordEvent({
      ...(quizSnapshot === null
        ? {}
        : {
            details: {
              quizId: quizSnapshot.id,
              quizTitle: quizSnapshot.title,
            },
          }),
      roomCode,
      type: "room_created",
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

  getRoomCodes(): string[] {
    return [...this.rooms.keys()];
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
    this.recordEvent({
      roomCode,
      type: "host_connected",
    });

    return {
      previousSocketId,
    };
  }

  disconnectHost(roomCode: string, socketId: string): void {
    const room = this.rooms.get(roomCode);

    if (room?.hostSocketId === socketId) {
      room.hostSocketId = null;
      this.touch(room);
      this.recordEvent({
        roomCode,
        type: "host_disconnected",
      });
    }
  }

  attachDisplay(roomCode: string, socketId: string): void {
    const room = this.requireRoom(roomCode);
    room.displaySocketIds.add(socketId);
    this.touch(room);
    this.recordEvent({
      roomCode,
      type: "display_connected",
    });
  }

  disconnectDisplay(roomCode: string, socketId: string): void {
    const room = this.rooms.get(roomCode);
    if (room?.displaySocketIds.delete(socketId) === true) {
      this.touch(room);
      this.recordEvent({
        roomCode,
        type: "display_disconnected",
      });
    }
  }

  addPlayer(
    roomCode: string,
    name: string,
    socketId: string,
    metadata: PlayerConnectionMetadata = {
      device: "Неизвестное устройство",
    },
  ): AddedPlayer {
    const room = this.requireRoom(roomCode);

    if (room.session !== null) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Игра уже началась, новые игроки больше не подключаются",
      );
    }

    const playerName = parsePlayerName(name);
    const normalizedName = playerName.toLocaleLowerCase("ru-RU");
    const nameIsTaken = [...room.players.values()].some(
      (player) => player.name.toLocaleLowerCase("ru-RU") === normalizedName,
    );

    if (nameIsTaken) {
      throw new RoomError("NAME_TAKEN", "Игрок с таким именем уже подключён");
    }

    const playerId = this.idGenerator();
    const playerToken = this.tokenGenerator();

    room.players.set(playerId, {
      connected: true,
      device: metadata.device,
      id: playerId,
      joinedAt: this.now(),
      name: playerName,
      pingMs: null,
      score: 0,
      socketId,
      tokenHash: hashToken(playerToken),
    });
    this.touch(room);
    this.recordEvent({
      details: {
        playerId,
        playerName,
      },
      roomCode,
      type: "player_connected",
    });

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
    metadata?: PlayerConnectionMetadata,
  ): ReconnectedPlayer {
    const room = this.requireRoom(roomCode);
    const player = this.findPlayerByToken(room, playerToken);
    const previousSocketId = player.socketId;

    player.connected = true;
    if (metadata !== undefined) {
      player.device = metadata.device;
    }
    player.socketId = socketId;
    this.touch(room);
    this.recordEvent({
      details: {
        playerId: player.id,
        playerName: player.name,
        reconnected: true,
      },
      roomCode,
      type: "player_connected",
    });

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
      this.recordEvent({
        details: {
          playerId: player.id,
          playerName: player.name,
        },
        roomCode,
        type: "player_disconnected",
      });
    }
  }

  updatePlayerPing(
    roomCode: string,
    playerId: string,
    socketId: string,
    pingMs: number,
  ): void {
    const room = this.requireRoom(roomCode);
    const player = room.players.get(playerId);

    if (
      player === undefined ||
      !player.connected ||
      player.socketId !== socketId
    ) {
      throw new RoomError("PLAYER_UNAUTHORIZED", "Игрок не найден");
    }

    player.pingMs = pingMs;
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
      room.session?.getPhase() === "buzzing" ||
      room.session?.getPhase() === "modifier-buzzing"
        ? (room.quizSnapshot?.settings.buzzSeconds ?? durationMs / 1_000) *
          1_000
        : durationMs;
    const opened = this.openBuzzerRecord(room, gameDurationMs);
    if (
      room.session?.getPhase() === "buzzing" ||
      room.session?.getPhase() === "modifier-buzzing"
    ) {
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
    if (
      room.session?.getPhase() === "buzzing" ||
      room.session?.getPhase() === "modifier-buzzing"
    ) {
      room.session.expireBuzzTimer();
    }
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

    if (buzzer.status !== "open") {
      throw new RoomError("BUZZER_CLOSED", "Кнопки сейчас закрыты");
    }

    buzzer.pressedPlayerIds.add(player.id);
    if (room.session?.getPhase() === "modifier-buzzing") {
      room.session.claimModifier(player.id, room.players);
      buzzer.winnerPlayerId = player.id;
      buzzer.status = "winner";
      buzzer.closeReason = "manual";
    }
    this.touch(room);
    this.recordEvent({
      details: {
        playerId: player.id,
        playerName: player.name,
        position: buzzer.pressedPlayerIds.size,
        windowId: buzzWindowId,
      },
      roomCode,
      type: "buzzer_pressed",
    });
  }

  selectAnsweringPlayer(
    roomCode: string,
    hostToken: string,
    playerId: string,
  ): TimerState {
    const room = this.requireHost(roomCode, hostToken);
    const session = this.requireSession(room);
    const buzzer = room.buzzer;
    const player = room.players.get(playerId);

    if (
      buzzer === null ||
      player === undefined ||
      !buzzer.pressedPlayerIds.has(playerId)
    ) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Можно выбрать только игрока, который нажал кнопку",
      );
    }

    const timer = session.beginAnswer(playerId);
    buzzer.winnerPlayerId = playerId;
    buzzer.status = "winner";
    buzzer.closeReason = "manual";
    this.touch(room);
    this.recordEvent({
      details: {
        playerId,
        playerName: player.name,
        position: [...buzzer.pressedPlayerIds].indexOf(playerId) + 1,
        windowId: buzzer.id,
      },
      roomCode,
      type: "answer_selected",
    });
    return timer;
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
      this.random,
    );
    room.buzzer = null;
    this.touch(room);
    this.recordEvent({
      roomCode,
      type: "session_started",
    });
  }

  changeRound(roomCode: string, hostToken: string, roundIndex: number): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).changeRound(roundIndex);
    room.buzzer = null;
    this.touch(room);
    this.recordEvent({
      details: { roundIndex },
      roomCode,
      type: "round_changed",
    });
  }

  startThemeExplanation(
    roomCode: string,
    hostToken: string,
    themeId: string,
  ): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).startThemeExplanation(themeId);
    room.buzzer = null;
    this.touch(room);
    this.recordEvent({
      details: { themeId },
      roomCode,
      type: "theme_explanation_started",
    });
  }

  selectQuestion(
    roomCode: string,
    hostToken: string,
    questionId: string,
  ): SelectedQuestion {
    const room = this.requireHost(roomCode, hostToken);
    const session = this.requireSession(room);
    const selection = session.selectQuestion(questionId, room.players);
    room.buzzer = null;
    let buzzer: OpenedBuzzer | null = null;
    if (selection.kind === "modifier") {
      const durationMs =
        (room.quizSnapshot?.settings.buzzSeconds ?? 10) * 1_000;
      buzzer = this.openBuzzerRecord(room, durationMs);
      session.setBuzzTimer(buzzer.timer);
    }
    this.touch(room);
    this.recordEvent({
      details: { questionId },
      roomCode,
      type: "question_selected",
    });
    return { buzzer, timer: selection.timer };
  }

  submitWager(
    roomCode: string,
    playerToken: string,
    wager: number,
  ): TimerState | null {
    const room = this.requireRoom(roomCode);
    const player = this.findPlayerByToken(room, playerToken);
    const timer = this.requireSession(room).submitWager(player.id, wager);
    this.touch(room);
    return timer;
  }

  configureGiveaway(
    roomCode: string,
    hostToken: string,
    playerId: string,
    wager: number,
  ): TimerState {
    const room = this.requireHost(roomCode, hostToken);
    if (!room.players.has(playerId)) {
      throw new RoomError("PLAYER_UNAUTHORIZED", "Игрок не найден");
    }
    const timer = this.requireSession(room).configureGiveaway(playerId, wager);
    this.touch(room);
    return timer;
  }

  restartMedia(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).restartMedia();
    this.touch(room);
    this.recordEvent({ roomCode, type: "media_restarted" });
  }

  stopMedia(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).stopMedia();
    this.touch(room);
    this.recordEvent({ roomCode, type: "media_stopped" });
  }

  completeQuestionIntro(roomCode: string): OpenedBuzzer | null {
    const room = this.requireRoom(roomCode);
    const session = this.requireSession(room);
    const phase = session.completeQuestionIntro();
    if (phase === "answering") {
      room.buzzer = null;
      this.touch(room);
      return null;
    }
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
    const proposal = this.requireSession(room).judgeAnswer(
      judgement,
      room.players,
    );
    this.touch(room);
    this.recordEvent({
      details: {
        judgement,
        playerId: proposal.playerId,
        playerName: proposal.playerName,
        questionId: proposal.questionId,
      },
      roomCode,
      type: "answer_judged",
    });
  }

  cancelScoreProposal(
    roomCode: string,
    hostToken: string,
  ): "answer-reveal" | "answering" | "buzzing" {
    const room = this.requireHost(roomCode, hostToken);
    const session = this.requireSession(room);
    const outcome = session.cancelScoreProposal();

    if (outcome === "buzzing") {
      const durationMs =
        (room.quizSnapshot?.settings.buzzSeconds ?? 10) * 1_000;
      const opened = this.reopenBuzzerRecord(room, durationMs);
      session.setBuzzTimer(opened.timer);
    } else if (outcome === "answer-reveal") {
      room.buzzer = null;
    }
    this.touch(room);
    return outcome;
  }

  proposeNoAnswerPenalty(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);
    const proposal = this.requireSession(room).createNoAnswerProposal(
      room.players,
    );
    if (room.buzzer !== null) {
      room.buzzer.closeReason = "manual";
      room.buzzer.status = "closed";
      room.buzzer.winnerPlayerId = null;
    }
    this.touch(room);
    this.recordEvent({
      details: {
        playerCount: proposal.playerIds.length,
        questionId: proposal.questionId,
        suggestedDelta: proposal.suggestedDelta,
      },
      roomCode,
      type: "no_answer_penalty_proposed",
    });
  }

  confirmScore(
    roomCode: string,
    hostToken: string,
    proposalId: string,
    delta: number,
  ): "answer-reveal" | "buzzing" {
    const room = this.requireHost(roomCode, hostToken);
    const session = this.requireSession(room);
    const proposal = session.getState().scoreProposal;
    const outcome = session.confirmScore(proposalId, delta, room.players);

    if (outcome === "buzzing") {
      const durationMs =
        (room.quizSnapshot?.settings.buzzSeconds ?? 10) * 1_000;
      const opened = this.reopenBuzzerRecord(room, durationMs);
      session.setBuzzTimer(opened.timer);
    } else {
      room.buzzer = null;
    }

    this.touch(room);
    this.recordEvent({
      details: {
        delta,
        outcome,
        playerCount:
          proposal?.target === "all-players"
            ? proposal.playerIds.length
            : proposal === null
              ? 0
              : 1,
        playerId: proposal?.target === "player" ? proposal.playerId : null,
        proposalId,
        target: proposal?.target ?? null,
      },
      roomCode,
      type: "score_confirmed",
    });
    return outcome;
  }

  adjustPlayerScore(
    roomCode: string,
    hostToken: string,
    playerId: string,
    delta: number,
  ): void {
    const room = this.requireHost(roomCode, hostToken);
    const phase = room.session?.getPhase();

    if (
      phase !== undefined &&
      phase !== "board" &&
      phase !== "round-finished" &&
      phase !== "game-finished"
    ) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Баллы можно корректировать только вне вопроса",
      );
    }

    const player = room.players.get(playerId);
    if (player === undefined) {
      throw new RoomError("PLAYER_UNAUTHORIZED", "Игрок не найден");
    }

    player.score += delta;
    this.touch(room);
    this.recordEvent({
      details: {
        delta,
        playerId: player.id,
        playerName: player.name,
      },
      roomCode,
      type: "score_adjusted",
    });
  }

  updatePlayer(
    roomCode: string,
    hostToken: string,
    playerId: string,
    name: string,
    delta: number,
  ): void {
    const room = this.requireHost(roomCode, hostToken);
    const phase = room.session?.getPhase();

    if (
      phase !== undefined &&
      phase !== "board" &&
      phase !== "round-finished" &&
      phase !== "game-finished"
    ) {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "Игрока можно изменять только вне вопроса",
      );
    }

    const player = room.players.get(playerId);
    if (player === undefined) {
      throw new RoomError("PLAYER_UNAUTHORIZED", "Игрок не найден");
    }

    const playerName = parsePlayerName(name);
    const normalizedName = playerName.toLocaleLowerCase("ru-RU");
    const nameIsTaken = [...room.players.values()].some(
      (candidate) =>
        candidate.id !== playerId &&
        candidate.name.toLocaleLowerCase("ru-RU") === normalizedName,
    );
    if (nameIsTaken) {
      throw new RoomError("NAME_TAKEN", "Игрок с таким именем уже подключён");
    }

    const previousName = player.name;
    player.name = playerName;
    player.score += delta;
    this.touch(room);
    this.recordEvent({
      details: {
        delta,
        playerId: player.id,
        playerName,
        previousName,
      },
      roomCode,
      type: "player_updated",
    });
  }

  skipTimer(roomCode: string, hostToken: string): OpenedBuzzer | null {
    const room = this.requireHost(roomCode, hostToken);
    const session = this.requireSession(room);
    const phase = session.getPhase();
    let opened: OpenedBuzzer | null = null;

    if (phase === "theme-explanation") {
      session.finishThemeExplanation();
      room.buzzer = null;
      this.touch(room);
    } else if (phase === "question-intro") {
      opened = this.completeQuestionIntro(roomCode);
    } else if (phase === "buzzing" || phase === "modifier-buzzing") {
      if (room.buzzer === null || room.buzzer.status !== "open") {
        throw new RoomError(
          "SESSION_INVALID_PHASE",
          "Активного таймера нажатий нет",
        );
      }
      room.buzzer.status = "closed";
      room.buzzer.closeReason = "expired";
      session.expireBuzzTimer();
      this.touch(room);
    } else if (phase === "answering") {
      this.judgeAnswer(roomCode, hostToken, "timeout");
    } else if (phase === "answer-reveal") {
      this.finishQuestion(roomCode);
    } else {
      throw new RoomError(
        "SESSION_INVALID_PHASE",
        "В текущей фазе нет таймера для пропуска",
      );
    }

    this.recordEvent({
      details: { phase },
      roomCode,
      type: "timer_skipped",
    });
    return opened;
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
    const questionId =
      this.requireSession(room).getState().activeQuestion?.id ?? null;
    this.requireSession(room).finishQuestion();
    room.buzzer = null;
    this.touch(room);
    this.recordEvent({
      details: { questionId },
      roomCode,
      type: "question_finished",
    });
  }

  finishSession(roomCode: string, hostToken: string): void {
    const room = this.requireHost(roomCode, hostToken);
    this.requireSession(room).finishSession();
    room.buzzer = null;
    this.touch(room);
    this.recordEvent({
      roomCode,
      type: "session_finished",
    });
  }

  getHostState(roomCode: string): HostRoomState {
    const room = this.requireRoom(roomCode);
    const buzzer = room.buzzer;
    const buzzPositions = new Map(
      [...(buzzer?.pressedPlayerIds ?? [])].map((playerId, index) => [
        playerId,
        index + 1,
      ]),
    );
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
      connectedClientCount:
        (room.hostSocketId === null ? 0 : 1) +
        room.displaySocketIds.size +
        [...room.players.values()].filter((player) => player.connected).length,
      connectedDisplayCount: room.displaySocketIds.size,
      game: room.session?.getState() ?? null,
      players: [...room.players.values()]
        .map((player): HostPlayer => ({
          ...toPublicPlayer(player),
          buzzPosition: buzzPositions.get(player.id) ?? null,
          device: player.device,
          joinedAt: player.joinedAt,
          pingMs: player.pingMs,
        }))
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
    const wagerState = room.session?.getState().wagers ?? null;
    const submittedWager = room.session?.getPlayerWager(playerId) ?? null;

    return {
      answerDelta: room.session?.getAnswerDelta(playerId) ?? null,
      buzzer: {
        position:
          room.buzzer === null
            ? null
            : [...room.buzzer.pressedPlayerIds].indexOf(playerId) + 1 || null,
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
      wager:
        room.session?.getPhase() === "wagering" && wagerState !== null
          ? {
              maximum: wagerState.maximum,
              submitted: submittedWager !== null,
              value: submittedWager ?? Math.min(100, wagerState.maximum),
            }
          : null,
    };
  }

  getDisplayState(roomCode: string): DisplayRoomState {
    const room = this.requireRoom(roomCode);
    const players = [...room.players.values()];

    return {
      connectedPlayerCount: players.filter((player) => player.connected).length,
      game: room.session?.getDisplayState(room.players) ?? null,
      quizTitle: room.quizSnapshot?.title ?? null,
      roomCode: room.code,
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
        room.displaySocketIds.size === 0 &&
        !hasConnectedPlayer &&
        now - room.lastActivityAt >= maxIdleMs
      ) {
        this.rooms.delete(roomCode);
        deletedRoomCodes.push(roomCode);
        this.recordEvent({
          roomCode,
          type: "room_deleted",
        });
      }
    }

    return deletedRoomCodes;
  }

  private requireHost(roomCode: string, hostToken: string): RoomRecord {
    const room = this.requireRoom(roomCode);

    if (!tokenMatches(hostToken, room.hostTokenHash)) {
      throw new RoomError("HOST_UNAUTHORIZED", "Нет доступа к комнате");
    }

    return room;
  }

  private findPlayerByToken(
    room: RoomRecord,
    playerToken: string,
  ): PlayerRecord {
    const player = [...room.players.values()].find((candidate) =>
      tokenMatches(playerToken, candidate.tokenHash),
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
    const session = room.session;

    if (session?.getCorrectPlayerId() === playerId) {
      return "correct";
    }

    if (session?.getAttemptedPlayerIds().has(playerId)) {
      return "answered-incorrectly";
    }

    if (buzzer === null) {
      return "waiting";
    }

    if (buzzer.status === "winner") {
      return buzzer.winnerPlayerId === playerId
        ? "winner"
        : "other-player-answering";
    }

    if (buzzer.pressedPlayerIds.has(playerId)) {
      return "queued";
    }

    if (buzzer.closeReason === "expired") {
      return "time-expired";
    }

    if (buzzer.status === "open") {
      return "ready";
    }

    return "waiting";
  }

  private touch(room: RoomRecord): void {
    room.lastActivityAt = this.now();
  }

  private recordEvent(event: SessionEventInput): void {
    this.journal?.record(event);
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
    this.recordEvent({
      details: {
        durationMs,
        windowId: buzzer.id,
      },
      roomCode: room.code,
      type: "buzzer_opened",
    });
    return {
      buzzWindowId: buzzer.id,
      timer,
    };
  }

  private reopenBuzzerRecord(
    room: RoomRecord,
    durationMs: number,
  ): OpenedBuzzer {
    if (room.buzzer === null) {
      return this.openBuzzerRecord(room, durationMs);
    }

    const startedAt = this.now();
    const timer: TimerState = {
      durationMs,
      endsAt: startedAt + durationMs,
      startedAt,
    };
    room.buzzer.closeReason = null;
    room.buzzer.status = "open";
    room.buzzer.timer = timer;
    room.buzzer.winnerPlayerId = null;
    this.recordEvent({
      details: {
        durationMs,
        preservedPressCount: room.buzzer.pressedPlayerIds.size,
        windowId: room.buzzer.id,
      },
      roomCode: room.code,
      type: "buzzer_opened",
    });
    return {
      buzzWindowId: room.buzzer.id,
      timer,
    };
  }
}
