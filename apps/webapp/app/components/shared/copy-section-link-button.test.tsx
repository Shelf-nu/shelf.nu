/**
 * Tests for the copy-link button on anchored cards.
 *
 * Mocks:
 * - `navigator.clipboard.writeText`: the test environment has no system
 *   clipboard to read back.
 *
 * @see {@link file://./copy-section-link-button.tsx}
 * @see {@link file://./card.tsx}
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Card, CardTitle } from "./card";

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  // why: happy-dom has no system clipboard; capturing the call is how the
  // test sees what the button copied.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  window.history.replaceState(null, "", "/settings/bookings");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CardTitle", () => {
  it("offers a copy-link button in a card with an anchor", () => {
    render(
      <Card id="automation">
        <CardTitle>Automation</CardTitle>
      </Card>
    );

    expect(
      screen.getByRole("heading", { name: "Automation" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy link to Automation" })
    ).toBeInTheDocument();
  });

  it("has no button in a card without an anchor", () => {
    render(
      <Card>
        <CardTitle>Automation</CardTitle>
      </Card>
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("CopySectionLinkButton", () => {
  it("copies the page URL with the section's hash and points the address bar at it", async () => {
    render(
      <Card id="automation">
        <CardTitle>Automation</CardTitle>
      </Card>
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy link to Automation" })
      );
      // Let the clipboard write settle before asserting on its outcome.
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/settings/bookings#automation`
    );
    expect(window.location.hash).toBe("#automation");
    expect(
      screen.getByText("Link copied", { selector: "[aria-live]" })
    ).toBeInTheDocument();
  });

  it("clears the confirmation after a moment", async () => {
    vi.useFakeTimers();
    render(
      <Card id="automation">
        <CardTitle>Automation</CardTitle>
      </Card>
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy link to Automation" })
      );
      // Let the clipboard write settle before asserting on its outcome.
      await Promise.resolve();
    });
    expect(
      screen.queryByText("Link copied", { selector: "[aria-live]" })
    ).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      screen.queryByText("Link copied", { selector: "[aria-live]" })
    ).not.toBeInTheDocument();
  });

  it("still points the address bar at the section when the clipboard refuses", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    render(
      <Card id="automation">
        <CardTitle>Automation</CardTitle>
      </Card>
    );

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Copy link to Automation" })
      );
      // Let the clipboard write settle before asserting on its outcome.
      await Promise.resolve();
    });

    expect(window.location.hash).toBe("#automation");
    expect(
      screen.queryByText("Link copied", { selector: "[aria-live]" })
    ).not.toBeInTheDocument();
  });
});
