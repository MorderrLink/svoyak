import { z } from "zod";

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{4}$/, "Код комнаты должен содержать 4 символа");

export const roomNameSchema = z
  .string()
  .trim()
  .min(1, "Введите имя")
  .max(32, "Имя не должно быть длиннее 32 символов")
  .regex(/^[^\p{C}]+$/u, "Имя содержит недопустимые символы");

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

export const selectQuestionPayloadSchema = reconnectHostPayloadSchema
  .extend({
    questionId: z.uuid(),
  })
  .strict();

export const judgeAnswerPayloadSchema = reconnectHostPayloadSchema
  .extend({
    judgement: z.enum(["correct", "incorrect", "timeout"]),
  })
  .strict();

export const confirmScorePayloadSchema = reconnectHostPayloadSchema
  .extend({
    delta: z.number().int().min(-1_000_000).max(1_000_000),
    proposalId: z.uuid(),
  })
  .strict();
