import { describe, expect, it } from "vitest";

import { createHttpServer } from "@/server/http/create-http-server";

describe("HTTP-сервер приложения", () => {
  it("создаётся вместе с Socket.IO", () => {
    const { httpServer, io } = createHttpServer((_request, response) => {
      response.end("ok");
    });

    expect(httpServer.listening).toBe(false);
    expect(io.engine).toBeDefined();

    io.removeAllListeners();
    httpServer.removeAllListeners();
  });
});
