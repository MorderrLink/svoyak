import { describe, expect, it } from "vitest";

import Home from "@/app/page";

describe("приложение", () => {
  it("импортируется без ошибок", () => {
    expect(Home()).toBeDefined();
  });
});
