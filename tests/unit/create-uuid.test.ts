import { afterEach, describe, expect, it, vi } from "vitest";

import { createUuid } from "@/shared/utils/create-uuid";

describe("createUuid", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("создаёт уникальные UUID v4, совместимые с Zod", () => {
    const identifiers = Array.from({ length: 100 }, createUuid);

    expect(new Set(identifiers)).toHaveLength(identifiers.length);
    for (const identifier of identifiers) {
      expect(identifier).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it("работает без crypto.randomUUID на обычном LAN HTTP", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(42);
        return bytes;
      },
    });

    expect(createUuid()).toBe("2a2a2a2a-2a2a-4a2a-aa2a-2a2a2a2a2a2a");
  });
});
