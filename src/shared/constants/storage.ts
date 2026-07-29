export const hostSessionStorageKey = "svoyak:host-session";

export function getPlayerTokenStorageKey(roomCode: string): string {
  return `svoyak:player:${roomCode}`;
}
