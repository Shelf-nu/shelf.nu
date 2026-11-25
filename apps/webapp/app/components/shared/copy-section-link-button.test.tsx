/**
 * Tests for card titles and the copy-link button on anchored cards.
 *
 * Mocks:
 * - `navigator.clipboard.writeText`: the test environment has no system
 *   clipboard to read back.
 *
 * @see {@link file://./copy-section-link-button.tsx}
 * @see {@link file://./card.tsx}
 */
import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Card, CardTitle, SectionLinksProvider } from "./card";
import { TooltipProvider } from "./tooltip";

const writeText = vi.fn<(text: string) => Promise<void>>();

/**
 * A page whose sections are linkable, as the settings layout renders it.
 * The tooltip provider stands in for the app-level one in root.tsx.
 */
function LinkablePage({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SectionLinksProvider>{children}</SectionLinksProvider>
    </TooltipProvider>
  );
}

/** Clicks the button and lets the clipboard write settle. */
async function clickCopy(sectionTitle: string) {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: `Copy link to ${sectionTitle}` })
    );
    await Promise.resolve();
  });
}

/** The text announced to screen readers. */
function announcement() {
  return document.querySelector("[aria-live]")?.textContent ?? "";
}

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
  it("offers a copy-link button in an anchored card on a linkable page", () => {
    render(
      <LinkablePage>
        <Card id="automation">
          <CardTitle>Automation</CardTitle>
        </Card>
      </LinkablePage>
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
      <LinkablePage>
        <Card>
          <CardTitle>Automation</CardTitle>
        </Card>
      </LinkablePage>
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has no button on a page that is not built to be linked into", () => {
    // The same cards render on the admin dashboard and the account pages.
    render(
      <Card id="transfer-ownership">
        <CardTitle>Transfer workspace ownership</CardTitle>
      </Card>
    );

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(document.getElementById("transfer-ownership")).not.toBeNull();
  });

  it("links a section that is not a Card through its anchorId", async () => {
    render(
      <LinkablePage>
        <div id="custom-email-footer">
          <CardTitle anchorId="custom-email-footer">
            Custom email footer
          </CardTitle>
        </div>
      </LinkablePage>
    );

    await clickCopy("Custom email footer");

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/settings/bookings#custom-email-footer`
    );
  });

  it("puts spacing classes on the title row, not on the heading", () => {
    render(
      <LinkablePage>
        <Card id="transfer-ownership">
          <CardTitle as="h4" className="mb-1">
            Transfer workspace ownership
          </CardTitle>
        </Card>
      </LinkablePage>
    );

    const heading = screen.getByRole("heading", { level: 4 });
    expect(heading).not.toHaveClass("mb-1");
    expect(heading.parentElement).toHaveClass("mb-1");
  });
});

describe("CopySectionLinkButton", () => {
  function renderAutomationCard() {
    render(
      <LinkablePage>
        <Card id="automation">
          <CardTitle>Automation</CardTitle>
        </Card>
      </LinkablePage>
    );
  }

  it("copies the page URL with the section's hash and points the address bar at it", async () => {
    renderAutomationCard();

    await clickCopy("Automation");

    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}/settings/bookings#automation`
    );
    expect(window.location.hash).toBe("#automation");
    expect(announcement()).toBe("Link copied");
  });

  it("clears the confirmation after a moment", async () => {
    vi.useFakeTimers();
    renderAutomationCard();

    await clickCopy("Automation");
    expect(announcement()).toBe("Link copied");

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(announcement()).toBe("");
  });

  it("says the copy failed when the clipboard refuses, and still points the address bar at the section", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderAutomationCard();

    await clickCopy("Automation");

    expect(window.location.hash).toBe("#automation");
    expect(announcement()).toBe(
      "Couldn't copy. The link is in the address bar."
    );
  });
});
