import type { QuizImage } from "@/shared/types/quiz";

export type SocketErrorCode =
  | "BUZZER_CLOSED"
  | "BUZZ_ALREADY_PRESSED"
  | "BUZZ_ALREADY_WON"
  | "BUZZ_WINDOW_EXPIRED"
  | "BUZZ_WINDOW_MISMATCH"
  | "HOST_UNAUTHORIZED"
  | "INTERNAL_ERROR"
  | "INVALID_PAYLOAD"
  | "NAME_TAKEN"
  | "PLAYER_UNAUTHORIZED"
  | "QUIZ_NOT_FOUND"
  | "RATE_LIMITED"
  | "ROOM_NOT_FOUND"
  | "SESSION_INVALID_PHASE"
  | "SESSION_NOT_STARTED"
  | "TOO_MANY_ERRORS";

export interface SocketError {
  code: SocketErrorCode;
  fieldErrors?: Record<string, string[]>;
  message: string;
}

export type SocketResult<T> =
  | {
      data: T;
      ok: true;
    }
  | {
      error: SocketError;
      ok: false;
    };

export interface TimerState {
  durationMs: number;
  endsAt: number;
  startedAt: number;
}

export interface PublicPlayer {
  connected: boolean;
  id: string;
  name: string;
  score: number;
}

export type HostBuzzerStatus = "closed" | "open" | "winner";
export type BuzzerCloseReason = "expired" | "manual" | "reset";

export interface HostBuzzerState {
  closeReason: BuzzerCloseReason | null;
  status: HostBuzzerStatus;
  timer: TimerState | null;
  windowId: string | null;
  winner: Pick<PublicPlayer, "id" | "name"> | null;
}

export interface HostRoomState {
  buzzer: HostBuzzerState;
  connectedClientCount: number;
  connectedDisplayCount: number;
  game: HostGameState | null;
  players: PublicPlayer[];
  quizTitle: string | null;
  roomCode: string;
}

export interface DisplayPlayer {
  name: string;
  score: number | null;
}

export interface DisplayQuestion {
  answer: string | null;
  currentPlayerName: string | null;
  id: string;
  image: QuizImage | null;
  price: number;
  text: string | null;
  themeTitle: string;
}

export interface DisplayGameState {
  activeQuestion: DisplayQuestion | null;
  board: GameBoardTheme[];
  currentRoundIndex: number;
  phase: GamePhase;
  roundCount: number;
  timer: TimerState | null;
}

export interface DisplayRoomState {
  connectedPlayerCount: number;
  game: DisplayGameState | null;
  players: DisplayPlayer[];
  quizTitle: string | null;
  roomCode: string;
}

export type PlayerBuzzerStatus =
  | "answered-incorrectly"
  | "other-player-answering"
  | "ready"
  | "time-expired"
  | "waiting"
  | "winner";

export interface PlayerBuzzerState {
  status: PlayerBuzzerStatus;
  timer: TimerState | null;
  windowId: string | null;
}

export interface PlayerScreenState {
  buzzer: PlayerBuzzerState;
  connected: boolean;
  name: string;
  playerId: string;
  phase: GamePhase | null;
  roomCode: string;
  score: number;
  showScore: boolean;
}

export interface PublicRoomState {
  buzzerStatus: HostBuzzerStatus;
  connectedPlayerCount: number;
  roomCode: string;
}

export interface CreateRoomPayload {
  quizId: string;
}

export interface CreateRoomResult {
  applicationUrls: string[];
  hostToken: string;
  quizTitle: string;
  roomCode: string;
}

export interface CheckRoomPayload {
  roomCode: string;
}

export interface CheckRoomResult {
  exists: boolean;
  roomCode: string;
}

export interface JoinRoomPayload {
  name: string;
  roomCode: string;
}

export interface JoinRoomResult {
  playerId: string;
  playerToken: string;
  roomCode: string;
}

export interface ReconnectHostPayload {
  hostToken: string;
  roomCode: string;
}

export interface ReconnectPlayerPayload {
  playerToken: string;
  roomCode: string;
}

export interface ReconnectPlayerResult {
  playerId: string;
  roomCode: string;
}

export interface HostCommandPayload {
  hostToken: string;
  roomCode: string;
}

export interface OpenBuzzerPayload extends HostCommandPayload {
  durationMs: number;
}

export interface PressBuzzerPayload {
  buzzWindowId: string;
  playerToken: string;
  roomCode: string;
}

export interface OpenBuzzerResult {
  buzzWindowId: string;
  timer: TimerState;
}

export interface PressBuzzerResult {
  accepted: true;
}

export interface CommandResult {
  completed: true;
}

export type GamePhase =
  | "answer-reveal"
  | "answering"
  | "board"
  | "buzzing"
  | "game-finished"
  | "lobby"
  | "question-intro"
  | "round-finished"
  | "score-confirmation";

export interface GameBoardQuestion {
  id: string;
  played: boolean;
  price: number;
}

export interface GameBoardTheme {
  id: string;
  questions: GameBoardQuestion[];
  title: string;
}

export interface HostActiveQuestion {
  answer: string;
  attemptedPlayerIds: string[];
  currentPlayerId: string | null;
  hostComment: string | null;
  id: string;
  image: QuizImage | null;
  price: number;
  text: string | null;
  themeTitle: string;
}

export type AnswerJudgement = "correct" | "incorrect" | "timeout";

export interface ScoreChangeProposal {
  editedDelta: number;
  id: string;
  judgement: AnswerJudgement;
  playerId: string;
  playerName: string;
  questionId: string;
  questionPrice: number;
  suggestedDelta: number;
}

export interface HostGameState {
  activeQuestion: HostActiveQuestion | null;
  board: GameBoardTheme[];
  currentRoundIndex: number;
  phase: GamePhase;
  quizTitle: string;
  roundCount: number;
  scoreProposal: ScoreChangeProposal | null;
  timer: TimerState | null;
}

export interface SelectQuestionPayload extends HostCommandPayload {
  questionId: string;
}

export interface JudgeAnswerPayload extends HostCommandPayload {
  judgement: AnswerJudgement;
}

export interface ConfirmScorePayload extends HostCommandPayload {
  delta: number;
  proposalId: string;
}

export interface ClientToServerEvents {
  "room:attach-display": (
    payload: CheckRoomPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "buzzer:close": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "buzzer:open": (
    payload: OpenBuzzerPayload,
    callback: (result: SocketResult<OpenBuzzerResult>) => void,
  ) => void;
  "buzzer:press": (
    payload: PressBuzzerPayload,
    callback: (result: SocketResult<PressBuzzerResult>) => void,
  ) => void;
  "buzzer:reset": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "host:reconnect": (
    payload: ReconnectHostPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "answer:judge": (
    payload: JudgeAnswerPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "question:finish": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "question:select": (
    payload: SelectQuestionPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "score:cancel": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "score:confirm": (
    payload: ConfirmScorePayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "session:finish": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "session:start": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "player:reconnect": (
    payload: ReconnectPlayerPayload,
    callback: (result: SocketResult<ReconnectPlayerResult>) => void,
  ) => void;
  "room:check": (
    payload: CheckRoomPayload,
    callback: (result: SocketResult<CheckRoomResult>) => void,
  ) => void;
  "room:create": (
    payload: CreateRoomPayload,
    callback: (result: SocketResult<CreateRoomResult>) => void,
  ) => void;
  "room:join": (
    payload: JoinRoomPayload,
    callback: (result: SocketResult<JoinRoomResult>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  "display:state": (state: DisplayRoomState) => void;
  error: (error: SocketError) => void;
  "host:state": (state: HostRoomState) => void;
  "player:state": (state: PlayerScreenState) => void;
}

export type InterServerEvents = Record<never, never>;

export interface SocketData {
  playerId?: string;
  role?: "display" | "host" | "player";
  roomCode?: string;
}
