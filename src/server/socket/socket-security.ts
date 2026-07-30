import { createHash } from "node:crypto";

import type { SessionEventWriter } from "@/server/session/session-event-journal";

interface RateLimitBucket {
  timestamps: number[];
}

export interface SecurityDecision {
  allowed: boolean;
  disconnect: boolean;
  message?: string;
  retryAfterMs?: number;
}

export interface SocketSecurityOptions {
  closedPressCooldownMs?: number;
  errorLimit?: number;
  errorWindowMs?: number;
  playerPressLimit?: number;
  playerPressWindowMs?: number;
  socketEventLimit?: number;
  socketEventWindowMs?: number;
}

const defaultOptions = {
  closedPressCooldownMs: 500,
  errorLimit: 12,
  errorWindowMs: 10_000,
  playerPressLimit: 8,
  playerPressWindowMs: 1_000,
  socketEventLimit: 60,
  socketEventWindowMs: 5_000,
} satisfies Required<SocketSecurityOptions>;

function getIdentityHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export class SocketSecurity {
  private readonly acceptedPresses = new Map<string, number>();
  private readonly closedPresses = new Map<string, number>();
  private readonly errorBuckets = new Map<string, RateLimitBucket>();
  private readonly options: Required<SocketSecurityOptions>;
  private readonly playerBuckets = new Map<string, RateLimitBucket>();
  private readonly socketBuckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly journal?: SessionEventWriter,
    options: SocketSecurityOptions = {},
    private readonly now: () => number = Date.now,
  ) {
    this.options = {
      ...defaultOptions,
      ...options,
    };
  }

  checkSocketEvent(socketId: string, eventName: string): SecurityDecision {
    const decision = this.consume(
      this.socketBuckets,
      socketId,
      this.options.socketEventLimit,
      this.options.socketEventWindowMs,
    );
    if (!decision.allowed) {
      this.warn(undefined, {
        eventName,
        reason: "socket_rate_limit",
        socketId,
      });
    }
    return decision;
  }

  checkPlayerPress(
    playerToken: string,
    buzzWindowId: string,
    roomCode: string,
  ): SecurityDecision {
    const identity = getIdentityHash(playerToken);
    const acceptedKey = `${identity}:${buzzWindowId}`;
    this.pruneAcceptedPresses();
    if (this.acceptedPresses.has(acceptedKey)) {
      this.warn(roomCode, {
        reason: "duplicate_buzz_window",
      });
      return {
        allowed: false,
        disconnect: false,
        message: "Нажатие для этого окна уже было обработано",
      };
    }

    const cooldownStartedAt = this.closedPresses.get(identity);
    if (cooldownStartedAt !== undefined) {
      const elapsed = this.now() - cooldownStartedAt;
      if (elapsed < this.options.closedPressCooldownMs) {
        const retryAfterMs = this.options.closedPressCooldownMs - elapsed;
        this.warn(roomCode, {
          reason: "closed_press_cooldown",
          retryAfterMs,
        });
        return {
          allowed: false,
          disconnect: false,
          message: "Подождите перед повторным нажатием",
          retryAfterMs,
        };
      }
      this.closedPresses.delete(identity);
    }

    const decision = this.consume(
      this.playerBuckets,
      identity,
      this.options.playerPressLimit,
      this.options.playerPressWindowMs,
    );
    if (!decision.allowed) {
      this.warn(roomCode, {
        reason: "player_rate_limit",
        retryAfterMs: decision.retryAfterMs ?? null,
      });
    }
    return decision;
  }

  markAcceptedPress(playerToken: string, buzzWindowId: string): void {
    const identity = getIdentityHash(playerToken);
    this.acceptedPresses.set(`${identity}:${buzzWindowId}`, this.now());
    this.closedPresses.delete(identity);
  }

  markClosedPress(playerToken: string): void {
    this.closedPresses.set(getIdentityHash(playerToken), this.now());
  }

  recordError(socketId: string, errorCode: string, roomCode?: string): boolean {
    const decision = this.consume(
      this.errorBuckets,
      socketId,
      this.options.errorLimit,
      this.options.errorWindowMs,
    );
    this.journal?.record({
      details: {
        disconnect: decision.disconnect,
        errorCode,
        socketId,
      },
      ...(roomCode === undefined ? {} : { roomCode }),
      type: "socket_error",
    });
    return decision.disconnect;
  }

  removeSocket(socketId: string): void {
    this.errorBuckets.delete(socketId);
    this.socketBuckets.delete(socketId);
  }

  private consume(
    buckets: Map<string, RateLimitBucket>,
    key: string,
    limit: number,
    windowMs: number,
  ): SecurityDecision {
    const now = this.now();
    for (const [bucketKey, candidate] of buckets) {
      const newest = candidate.timestamps.at(-1);
      if (newest === undefined || now - newest >= windowMs) {
        buckets.delete(bucketKey);
      }
    }
    const bucket = buckets.get(key) ?? { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter(
      (timestamp) => now - timestamp < windowMs,
    );
    buckets.set(key, bucket);

    if (bucket.timestamps.length >= limit) {
      const oldest = bucket.timestamps[0] ?? now;
      return {
        allowed: false,
        disconnect: buckets === this.errorBuckets,
        message: "Слишком много событий. Попробуйте немного позже",
        retryAfterMs: Math.max(1, windowMs - (now - oldest)),
      };
    }

    bucket.timestamps.push(now);
    return {
      allowed: true,
      disconnect: false,
    };
  }

  private warn(
    roomCode: string | undefined,
    details: Record<string, boolean | null | number | string>,
  ): void {
    this.journal?.record({
      details,
      ...(roomCode === undefined ? {} : { roomCode }),
      type: "security_warning",
    });
  }

  private pruneAcceptedPresses(): void {
    const retentionMs = 60 * 60 * 1_000;
    const now = this.now();
    for (const [key, acceptedAt] of this.acceptedPresses) {
      if (now - acceptedAt >= retentionMs) {
        this.acceptedPresses.delete(key);
      }
    }
  }
}
