import { appendFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export type SessionEventType =
  | "answer_selected"
  | "answer_judged"
  | "buzzer_opened"
  | "buzzer_pressed"
  | "display_connected"
  | "display_disconnected"
  | "host_connected"
  | "host_disconnected"
  | "media_restarted"
  | "media_stopped"
  | "no_answer_penalty_proposed"
  | "player_connected"
  | "player_disconnected"
  | "player_updated"
  | "question_finished"
  | "question_selected"
  | "round_changed"
  | "room_created"
  | "room_deleted"
  | "score_confirmed"
  | "score_adjusted"
  | "security_warning"
  | "session_finished"
  | "session_started"
  | "socket_error"
  | "theme_explanation_started"
  | "timer_skipped";

export type SessionEventDetails = Record<
  string,
  boolean | null | number | string
>;

export interface SessionEventInput {
  details?: SessionEventDetails;
  roomCode?: string;
  type: SessionEventType;
}

export interface SessionEventRecord extends SessionEventInput {
  timestamp: string;
}

export interface SessionEventWriter {
  record(event: SessionEventInput): void;
}

function sanitizeDetails(details: SessionEventDetails): SessionEventDetails {
  const sanitized: SessionEventDetails = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|secret|password/i.test(key)) {
      continue;
    }
    sanitized[key] = value;
  }
  return sanitized;
}

export class SessionEventJournal implements SessionEventWriter {
  private readonly directory: string;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(
    gamesDirectory = resolve(process.cwd(), "games"),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.directory = resolve(gamesDirectory, ".sessions", "logs");
  }

  record(event: SessionEventInput): void {
    const timestamp = this.now().toISOString();
    const record: SessionEventRecord = {
      ...(event.details === undefined
        ? {}
        : { details: sanitizeDetails(event.details) }),
      ...(event.roomCode === undefined ? {} : { roomCode: event.roomCode }),
      timestamp,
      type: event.type,
    };
    const date = timestamp.slice(0, 10);
    const destination = resolve(this.directory, `${date}.jsonl`);

    this.pendingWrite = this.pendingWrite
      .then(async () => {
        await mkdir(this.directory, { recursive: true });
        await appendFile(destination, `${JSON.stringify(record)}\n`, "utf8");
      })
      .catch((error: unknown) => {
        console.error("Не удалось записать журнал игровой сессии:", error);
      });
  }

  async flush(): Promise<void> {
    await this.pendingWrite;
  }
}
