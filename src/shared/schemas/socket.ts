import { z } from "zod";

import { quizLimits } from "@/shared/constants/quiz";
import {
  normalizePlayerName,
  PLAYER_NAME_MAX_LENGTH,
} from "@/shared/player/player-name";

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{4}$/, "Код комнаты должен содержать 4 символа");

export const roomNameSchema = z.preprocess(
  (value) => (typeof value === "string" ? normalizePlayerName(value) : value),
  z
    .string()
    .min(1, "Введите имя")
    .max(
      PLAYER_NAME_MAX_LENGTH,
      `Имя не должно быть длиннее ${PLAYER_NAME_MAX_LENGTH} символов`,
    )
    .regex(/^[^\p{C}]+$/u, "Имя содержит недопустимые символы"),
);

const tokenSchema = z.uuid();

export const createRoomPayloadSchema = z
  .object({
    quizId: z.uuid(),
  })
  .strict();

export const checkRoomPayloadSchema = z
  .object({
    roomCode: roomCodeSchema,
  })
  .strict();

export const joinRoomPayloadSchema = z
  .object({
    name: roomNameSchema,
    roomCode: roomCodeSchema,
  })
  .strict();

export const reconnectHostPayloadSchema = z
  .object({
    hostToken: tokenSchema,
    roomCode: roomCodeSchema,
  })
  .strict();

export const reconnectPlayerPayloadSchema = z
  .object({
    playerToken: tokenSchema,
    roomCode: roomCodeSchema,
  })
  .strict();

export const hostCommandPayloadSchema = reconnectHostPayloadSchema;

export const openBuzzerPayloadSchema = reconnectHostPayloadSchema
  .extend({
    durationMs: z.number().int().min(1_000).max(60_000),
  })
  .strict();

export const pressBuzzerPayloadSchema = z
  .object({
    buzzWindowId: z.uuid(),
    playerToken: tokenSchema,
    roomCode: roomCodeSchema,
  })
  .strict();

export const hostSessionSchema = z
  .object({
    applicationUrls: z.array(z.url()),
    hostToken: tokenSchema,
    quizTitle: z.string().min(1),
    roomCode: roomCodeSchema,
  })
  .strict();

export const playerTokenSchema = tokenSchema;

export const emptyPayloadSchema = z.object({}).strict();

export const updatePlayerTelemetryPayloadSchema = z
  .object({
    pingMs: z.number().int().nonnegative().max(60_000),
  })
  .strict();

export const userAgentHeaderSchema = z.string().trim().max(1_024);

export const selectQuestionPayloadSchema = reconnectHostPayloadSchema
  .extend({
    questionId: z.uuid(),
  })
  .strict();

export const selectThemePayloadSchema = reconnectHostPayloadSchema
  .extend({
    themeId: z.uuid(),
  })
  .strict();

export const changeRoundPayloadSchema = reconnectHostPayloadSchema
  .extend({
    roundIndex: z.number().int().nonnegative().max(999),
  })
  .strict();

export const judgeAnswerPayloadSchema = reconnectHostPayloadSchema
  .extend({
    judgement: z.enum(["correct", "incorrect", "timeout"]),
  })
  .strict();

export const selectAnsweringPlayerPayloadSchema = reconnectHostPayloadSchema
  .extend({
    playerId: z.uuid(),
  })
  .strict();

export const configureGiveawayPayloadSchema = reconnectHostPayloadSchema
  .extend({
    playerId: z.uuid(),
    wager: z.number().int().min(quizLimits.wager.min).max(quizLimits.wager.max),
  })
  .strict();

export const submitWagerPayloadSchema = z
  .object({
    playerToken: tokenSchema,
    roomCode: roomCodeSchema,
    wager: z.number().int().min(quizLimits.wager.min).max(quizLimits.wager.max),
  })
  .strict();

export const confirmScorePayloadSchema = reconnectHostPayloadSchema
  .extend({
    delta: z.number().int().min(-1_000_000).max(1_000_000),
    proposalId: z.uuid(),
  })
  .strict();

export const adjustPlayerScorePayloadSchema = reconnectHostPayloadSchema
  .extend({
    delta: z.number().int().min(-1_000_000).max(1_000_000),
    playerId: z.uuid(),
  })
  .strict();

export const updatePlayerPayloadSchema = reconnectHostPayloadSchema
  .extend({
    delta: z.number().int().min(-1_000_000).max(1_000_000),
    name: roomNameSchema,
    playerId: z.uuid(),
  })
  .strict();
