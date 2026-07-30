import { z } from "zod";

import { quizConfigSchema } from "@/shared/schemas/quiz";
import { roomCodeSchema } from "@/shared/schemas/socket";

const identifierSchema = z.string().min(1).max(128);
const timestampSchema = z.number().int().nonnegative();
const tokenHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Некорректный хеш токена");

export const timerSnapshotSchema = z
  .object({
    durationMs: z.number().int().nonnegative(),
    endsAt: timestampSchema,
    startedAt: timestampSchema,
  })
  .strict();

export const scoreProposalSnapshotSchema = z
  .object({
    editedDelta: z.number().int().min(-1_000_000).max(1_000_000),
    id: identifierSchema,
    judgement: z.enum(["correct", "incorrect", "timeout"]),
    playerId: identifierSchema,
    playerName: z.string().trim().min(1).max(32),
    questionId: identifierSchema,
    questionPrice: z.number().int().positive(),
    suggestedDelta: z.number().int().min(-1_000_000).max(1_000_000),
  })
  .strict();

export const scoreOperationSnapshotSchema = z
  .object({
    confirmedAt: timestampSchema,
    delta: z.number().int().min(-1_000_000).max(1_000_000),
    id: identifierSchema,
    judgement: z.enum(["correct", "incorrect", "timeout"]),
    playerId: identifierSchema,
    questionId: identifierSchema,
  })
  .strict();

export const gameSessionSnapshotSchema = z
  .object({
    activeQuestion: z
      .object({
        attemptedPlayerIds: z.array(identifierSchema).max(100),
        currentPlayerId: identifierSchema.nullable(),
        questionId: identifierSchema,
      })
      .strict()
      .nullable(),
    currentRoundIndex: z.number().int().nonnegative(),
    phase: z.enum([
      "answer-reveal",
      "answering",
      "board",
      "buzzing",
      "game-finished",
      "lobby",
      "question-intro",
      "round-finished",
      "score-confirmation",
    ]),
    playedQuestionIds: z.array(identifierSchema),
    scoreOperations: z.array(scoreOperationSnapshotSchema).max(10_000),
    scoreProposal: scoreProposalSnapshotSchema.nullable(),
    timer: timerSnapshotSchema.nullable(),
  })
  .strict();

export const roomSnapshotSchema = z
  .object({
    buzzer: z
      .object({
        closeReason: z.enum(["expired", "manual", "reset"]).nullable(),
        id: identifierSchema,
        pressedPlayerIds: z.array(identifierSchema).max(100),
        status: z.enum(["closed", "open", "winner"]),
        timer: timerSnapshotSchema,
        winnerPlayerId: identifierSchema.nullable(),
      })
      .strict()
      .nullable(),
    code: roomCodeSchema,
    createdAt: timestampSchema,
    hostTokenHash: tokenHashSchema,
    lastActivityAt: timestampSchema,
    players: z
      .array(
        z
          .object({
            id: identifierSchema,
            name: z.string().trim().min(1).max(32),
            score: z.number().int().min(-1_000_000).max(1_000_000),
            tokenHash: tokenHashSchema,
          })
          .strict(),
      )
      .max(100),
    quizSnapshot: quizConfigSchema.nullable(),
    session: gameSessionSnapshotSchema.nullable(),
  })
  .strict();

export const activeRoomsSnapshotSchema = z
  .object({
    rooms: z.array(roomSnapshotSchema).max(1_000),
    savedAt: timestampSchema,
    schemaVersion: z.literal(1),
  })
  .strict();

export type ActiveRoomsSnapshot = z.infer<typeof activeRoomsSnapshotSchema>;
export type GameSessionSnapshot = z.infer<typeof gameSessionSnapshotSchema>;
export type RoomSnapshot = z.infer<typeof roomSnapshotSchema>;
export type ScoreOperationSnapshot = z.infer<
  typeof scoreOperationSnapshotSchema
>;
