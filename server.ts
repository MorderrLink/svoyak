import { startApplicationServer } from "@/server/start-application-server";

void startApplicationServer().catch((error: unknown) => {
  console.error("Не удалось запустить сервер:", error);
  process.exitCode = 1;
});
