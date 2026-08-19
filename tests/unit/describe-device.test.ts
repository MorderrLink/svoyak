import { describe, expect, it } from "vitest";

import { describeDevice } from "@/server/socket/describe-device";

describe("describeDevice", () => {
  it("определяет типичные мобильные и настольные устройства", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      describeDevice(
        "Mozilla/5.0 (Linux; Android 14; SM-S921B Build/UP1A) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36",
      ),
    ).toBe("SM-S921B · Chrome");
    expect(
      describeDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
      ),
    ).toBe("Компьютер Windows · Chrome");
  });

  it("возвращает безопасное значение без User-Agent", () => {
    expect(describeDevice(undefined)).toBe("Неизвестное устройство");
  });
});
