import next from "next";
import { z } from "zod";

import { createHttpServer } from "@/server/http/create-http-server";
import { getApplicationUrls } from "@/server/network/local-addresses";
import { RoomManager } from "@/server/room/room-manager";
import {
  RoomSnapshotPersistence,
  RoomSnapshotStore,
} from "@/server/session/room-snapshot-store";
import { SessionEventJournal } from "@/server/session/session-event-journal";
import { registerSocketHandlers } from "@/server/socket/register-socket-handlers";
import { SocketSecurity } from "@/server/socket/socket-security";

import type { Server as NodeHttpServer } from "node:http";
import type { Server as SocketIOServer } from "socket.io";

const host = "0.0.0.0";
const defaultPort = 3000;
const portSchema = z.coerce.number().int().min(1).max(65_535);

function getPort(): number {
  return portSchema.parse(process.env.PORT ?? defaultPort);
}

function listen(httpServer: NodeHttpServer, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const handleError = (error: Error) => {
      httpServer.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      httpServer.off("error", handleError);
      resolve();
    };

    httpServer.once("error", handleError);
    httpServer.once("listening", handleListening);
    httpServer.listen(port, host);
  });
}

async function closeSocketServer(io: SocketIOServer): Promise<void> {
  await io.close();
}

export async function startApplicationServer(): Promise<void> {
  const dev = process.env.NODE_ENV !== "production";
  const port = getPort();
  const nextApp = next({
    dev,
    hostname: host,
    port,
  });

  await nextApp.prepare();

  const requestHandler = nextApp.getRequestHandler();
  const { httpServer, io } = createHttpServer(requestHandler);
  const sessionJournal = new SessionEventJournal();
  const roomManager = new RoomManager({
    journal: sessionJournal,
  });
  const snapshotStore = new RoomSnapshotStore();
  const snapshot = await snapshotStore.load();
  if (snapshot !== null) {
    const restored = roomManager.restoreSnapshot(snapshot);
    roomManager.reconcileExpiredTimers();
    if (restored.length > 0) {
      console.log(`Восстановлены активные комнаты: ${restored.join(", ")}`);
    }
  }
  const snapshotPersistence = new RoomSnapshotPersistence(
    roomManager,
    snapshotStore,
  );
  snapshotPersistence.start();
  if (snapshot !== null) {
    snapshotPersistence.schedule();
  }
  const socketSecurity = new SocketSecurity(sessionJournal);
  const disposeSocketHandlers = registerSocketHandlers(io, roomManager, {
    applicationUrls: getApplicationUrls(port),
    security: socketSecurity,
  });

  await listen(httpServer, port);

  console.log(`Свояк запущен в режиме ${dev ? "development" : "production"}:`);
  for (const url of getApplicationUrls(port)) {
    console.log(`  ${url}`);
  }

  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Получен ${signal}. Завершение работы...`);

    try {
      disposeSocketHandlers();
      await snapshotPersistence.stop();
      await closeSocketServer(io);
      await sessionJournal.flush();
      await nextApp.close();
      console.log("Сервер остановлен.");
    } catch (error: unknown) {
      console.error("Ошибка при завершении сервера:", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}
