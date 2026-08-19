import type { QuizImage, QuizMedia } from "@/shared/types/quiz";

export type SocketErrorCode =
  | "BUZZER_CLOSED"
  | "BUZZ_ALREADY_PRESSED"
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

export interface MediaPlaybackState {
  playing: boolean;
  positionMs: number;
  revision: string;
  startedAt: number | null;
}

export interface PublicPlayer {
  connected: boolean;
  id: string;
  name: string;
  score: number;
}

export interface HostPlayer extends PublicPlayer {
  buzzPosition: number | null;
  device: string;
  joinedAt: number;
  pingMs: number | null;
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
  players: HostPlayer[];
  quizTitle: string | null;
  roomCode: string;
}

export interface DisplayQuestion {
  answer: string | null;
  answerImage: QuizImage | null;
  currentPlayerName: string | null;
  id: string;
  image: QuizImage | null;
  media: QuizMedia | null;
  price: number;
  text: string | null;
  themeTitle: string;
}

export interface DisplayGameState {
  activeQuestion: DisplayQuestion | null;
  activeThemeExplanation: ThemeExplanation | null;
  board: GameBoardTheme[];
  currentRoundIndex: number;
  mediaPlayback: MediaPlaybackState | null;
  phase: GamePhase;
  roundCount: number;
  timer: TimerState | null;
}

export interface DisplayRoomState {
  connectedPlayerCount: number;
  game: DisplayGameState | null;
  quizTitle: string | null;
  roomCode: string;
}

export type PlayerBuzzerStatus =
  | "answered-incorrectly"
  | "correct"
  | "other-player-answering"
  | "queued"
  | "ready"
  | "time-expired"
  | "waiting"
  | "winner";

export interface PlayerBuzzerState {
  position: number | null;
  status: PlayerBuzzerStatus;
  timer: TimerState | null;
  windowId: string | null;
}

export interface PlayerScreenState {
  answerDelta: number | null;
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

export interface PlayerPingResult {
  respondedAt: number;
}

export interface UpdatePlayerTelemetryPayload {
  pingMs: number;
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
  | "score-confirmation"
  | "theme-explanation";

export interface GameBoardQuestion {
  id: string;
  played: boolean;
  price: number;
}

export interface GameBoardTheme {
  description: string | null;
  id: string;
  questions: GameBoardQuestion[];
  title: string;
}

export interface ThemeExplanation {
  description: string;
  id: string;
  title: string;
}

export interface HostActiveQuestion {
  answer: string;
  answerImage: QuizImage | null;
  attemptedPlayerIds: string[];
  currentPlayerId: string | null;
  hostComment: string | null;
  id: string;
  image: QuizImage | null;
  media: QuizMedia | null;
  price: number;
  text: string | null;
  themeTitle: string;
}

export type AnswerJudgement = "correct" | "incorrect" | "timeout";

interface BaseScoreChangeProposal {
  editedDelta: number;
  id: string;
  questionId: string;
  questionPrice: number;
  suggestedDelta: number;
}

export interface PlayerScoreChangeProposal extends BaseScoreChangeProposal {
  judgement: AnswerJudgement;
  playerId: string;
  playerName: string;
  target: "player";
}

export interface AllPlayersScoreChangeProposal extends BaseScoreChangeProposal {
  playerIds: string[];
  playerNames: string[];
  target: "all-players";
}

export type ScoreChangeProposal =
  AllPlayersScoreChangeProposal | PlayerScoreChangeProposal;

export interface HostGameState {
  activeQuestion: HostActiveQuestion | null;
  activeThemeExplanation: ThemeExplanation | null;
  board: GameBoardTheme[];
  currentRoundIndex: number;
  mediaPlayback: MediaPlaybackState | null;
  phase: GamePhase;
  quizTitle: string;
  roundCount: number;
  scoreProposal: ScoreChangeProposal | null;
  timer: TimerState | null;
}

export interface SelectQuestionPayload extends HostCommandPayload {
  questionId: string;
}

export interface SelectThemePayload extends HostCommandPayload {
  themeId: string;
}

export interface SelectAnsweringPlayerPayload extends HostCommandPayload {
  playerId: string;
}

export interface ChangeRoundPayload extends HostCommandPayload {
  roundIndex: number;
}

export interface JudgeAnswerPayload extends HostCommandPayload {
  judgement: AnswerJudgement;
}

export interface ConfirmScorePayload extends HostCommandPayload {
  delta: number;
  proposalId: string;
}

export interface AdjustPlayerScorePayload extends HostCommandPayload {
  delta: number;
  playerId: string;
}

export interface UpdatePlayerPayload extends HostCommandPayload {
  delta: number;
  name: string;
  playerId: string;
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
  "answer:select": (
    payload: SelectAnsweringPlayerPayload,
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
  "media:restart": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "media:stop": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "theme:explain": (
    payload: SelectThemePayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "round:change": (
    payload: ChangeRoundPayload,
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
  "score:adjust": (
    payload: AdjustPlayerScorePayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "player:update": (
    payload: UpdatePlayerPayload,
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
  "timer:skip": (
    payload: HostCommandPayload,
    callback: (result: SocketResult<CommandResult>) => void,
  ) => void;
  "player:reconnect": (
    payload: ReconnectPlayerPayload,
    callback: (result: SocketResult<ReconnectPlayerResult>) => void,
  ) => void;
  "player:ping": (
    payload: Record<never, never>,
    callback: (result: SocketResult<PlayerPingResult>) => void,
  ) => void;
  "player:telemetry": (
    payload: UpdatePlayerTelemetryPayload,
    callback: (result: SocketResult<CommandResult>) => void,
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
