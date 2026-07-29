"use client";

import { io } from "socket.io-client";

import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@/shared/contracts/socket";

import type { Socket } from "socket.io-client";

export type ApplicationClientSocket = Socket<
  ServerToClientEvents,
  ClientToServerEvents
>;

export function createClientSocket(): ApplicationClientSocket {
  return io({
    autoConnect: false,
    transports: ["websocket", "polling"],
  });
}
