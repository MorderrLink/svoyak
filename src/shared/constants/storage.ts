export const hostSessionStorageKey = "svoyak:host-session";
export const playerFeedbackStorageKey = "svoyak:player-feedback";

export function getPlayerTokenStorageKey(roomCode: string): string {
  return `svoyak:player:${roomCode}`;
}
