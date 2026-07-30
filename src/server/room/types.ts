import type { GameSession } from "@/server/session/game-session";
import type {
  BuzzerCloseReason,
  HostBuzzerStatus,
  TimerState,
} from "@/shared/contracts/socket";
import type { QuizConfig } from "@/shared/types/quiz";

export interface PlayerRecord {
  connected: boolean;
  id: string;
  name: string;
  score: number;
  socketId: string | null;
  token: string;
}

export interface BuzzerWindowRecord {
  closeReason: BuzzerCloseReason | null;
  id: string;
  pressedPlayerIds: Set<string>;
  status: HostBuzzerStatus;
  timer: TimerState;
  winnerPlayerId: string | null;
}

export interface RoomRecord {
  buzzer: BuzzerWindowRecord | null;
  code: string;
  createdAt: number;
  displaySocketIds: Set<string>;
  hostSocketId: string | null;
  hostToken: string;
  lastActivityAt: number;
  players: Map<string, PlayerRecord>;
  quizSnapshot: QuizConfig | null;
  session: GameSession | null;
}
