// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BottomProgress } from "@/components/bottom-progress";

describe("BottomProgress", () => {
  it("ограничивает прогресс допустимым диапазоном", () => {
    const now = Date.now();

    render(
      <BottomProgress
        timer={{
          durationMs: 1_000,
          endsAt: now + 2_000,
          startedAt: now,
        }}
      />,
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
  });
});
