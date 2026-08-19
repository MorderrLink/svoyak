export const PLAYER_NAME_MAX_LENGTH = 20;

export function normalizePlayerName(value: string): string {
  return value.trim().replace(/[\p{Zs} ]+/gu, " ");
}
