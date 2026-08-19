import type { GameSession } from "@/server/session/game-session";
import type {
  BuzzerCloseReason,
  HostBuzzerStatus,
  TimerState,
} from "@/shared/contracts/socket";
import type { QuizConfig } from "@/shared/types/quiz";

export interface PlayerRecord {
  connected: boolean;
  device: string;
  id: string;
  joinedAt: number;
  name: string;
  pingMs: number | null;
  score: number;
  socketId: string | null;
  tokenHash: string;
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
  displaySocketIds: Set<string>;
  hostSocketId: string | null;
  hostTokenHash: string;
  lastActivityAt: number;
  players: Map<string, PlayerRecord>;
  quizSnapshot: QuizConfig | null;
  session: GameSession | null;
}
