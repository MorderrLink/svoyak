import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import { Server as SocketIOServer } from "socket.io";

import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from "@/shared/contracts/socket";

export type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void> | void;

export function createHttpServer(requestHandler: RequestHandler) {
  const httpServer = createServer((request, response) => {
    void Promise.resolve(requestHandler(request, response)).catch(
      (error: unknown) => {
        console.error("Не удалось обработать HTTP-запрос:", error);

        if (!response.headersSent) {
          response.statusCode = 500;
          response.setHeader("content-type", "text/plain; charset=utf-8");
        }

        if (!response.writableEnded) {
          response.end("Внутренняя ошибка сервера");
        }
      },
    );
  });

  const io = new SocketIOServer<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    serveClient: false,
  });

  return {
    httpServer,
    io,
  };
}
