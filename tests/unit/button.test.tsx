// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/button";

describe("Button", () => {
  it("рендерится и обрабатывает нажатие", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(<Button onClick={handleClick}>Продолжить</Button>);
    await user.click(screen.getByRole("button", { name: "Продолжить" }));

    expect(handleClick).toHaveBeenCalledOnce();
  });
});
