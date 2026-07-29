import type { SocketErrorCode } from "@/shared/contracts/socket";

export class RoomError extends Error {
  readonly code: SocketErrorCode;

  constructor(code: SocketErrorCode, message: string) {
    super(message);
    this.name = "RoomError";
    this.code = code;
  }
}
