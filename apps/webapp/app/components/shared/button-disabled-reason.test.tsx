import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

/**
 * Disabled-with-reason buttons explain themselves through a HoverCard.
 * Hover never fires on touch devices, so the reason must ALSO open on
 * click/tap — otherwise mobile users get a dead-looking grey button.
 */
describe("Button disabled with reason", () => {
  // why: fireEvent.click instead of userEvent — userEvent simulates the
  // full pointer sequence including hover, which would open the popup via
  // the hover path and hide a broken click path. fireEvent dispatches only
  // the click, which is what a touch tap reduces to.
  it("reveals the reason on click, not only on hover", () => {
    render(
      <Button
        type="button"
        disabled={{ reason: "Only the owner can do this." }}
      >
        Transfer ownership
      </Button>
    );

    expect(
      screen.queryByText(/only the owner can do this/i)
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: /transfer ownership/i })
    );

    expect(screen.getByText(/only the owner can do this/i)).toBeInTheDocument();
  });

  it("hides the reason again on a second click", () => {
    render(
      <Button
        type="button"
        disabled={{ reason: "Only the owner can do this." }}
      >
        Transfer ownership
      </Button>
    );

    const button = screen.getByRole("button", { name: /transfer ownership/i });
    fireEvent.click(button);
    expect(screen.getByText(/only the owner can do this/i)).toBeInTheDocument();

    fireEvent.click(button);
    expect(
      screen.queryByText(/only the owner can do this/i)
    ).not.toBeInTheDocument();
  });
});
