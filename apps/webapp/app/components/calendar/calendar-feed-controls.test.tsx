/**
 * Tests for {@link CalendarFeedControls}: the "generate" empty state vs the
 * "manage" state (url + regenerate + stop sharing), and the two-step
 * "Stop sharing" confirm flow.
 *
 * @see {@link file://./calendar-feed-controls.tsx}
 */
import type React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import CalendarFeedControls from "./calendar-feed-controls";

// why: useFetcher needs a data router; we only assert on rendered markup and
// hidden-field wiring, so a static idle fetcher with a plain <form> stand-in
// is enough (mirrors feedback-modal.test.tsx's react-router mock). The
// "manage" state also renders a `<Button to={webcalUrl}>` (a real `Link`),
// so tests still wrap render() in a `<MemoryRouter>` for router context.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useFetcher: () => ({
      state: "idle" as const,
      data: undefined,
      submit: vi.fn(),
      load: vi.fn(),
      Form: (props: React.ComponentProps<"form">) => <form {...props} />,
    }),
  };
});

// why: useDisabled reads navigation state from the router; stabilise to
// false so we don't need a full data router context for these render tests.
vi.mock("~/hooks/use-disabled", () => ({
  useDisabled: () => false,
}));

/** Reads a hidden input by name from the rendered form. */
function getHiddenInput(name: string): HTMLInputElement | null {
  return document.querySelector(`input[type="hidden"][name="${name}"]`);
}

describe("CalendarFeedControls", () => {
  it("shows the generate CTA with org-scoped hidden fields when no feed exists", () => {
    render(
      <MemoryRouter>
        <CalendarFeedControls organizationId="org-1" calendarFeedUrl={null} />
      </MemoryRouter>
    );

    expect(
      screen.getByRole("button", { name: "Generate calendar link" })
    ).toBeTruthy();
    expect(getHiddenInput("organizationId")?.value).toBe("org-1");
    expect(getHiddenInput("intent")?.value).toBe("generate");
  });

  it("shows the url, Regenerate and Stop sharing controls when a feed exists", () => {
    render(
      <MemoryRouter>
        <CalendarFeedControls
          organizationId="org-1"
          calendarFeedUrl="https://example.com/api/calendar/feed/token123.ics"
        />
      </MemoryRouter>
    );

    expect(
      screen.getByDisplayValue(
        "https://example.com/api/calendar/feed/token123.ics"
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Stop sharing" })).toBeTruthy();
    // Regenerate's form also carries the org-scoped hidden field.
    expect(getHiddenInput("organizationId")?.value).toBe("org-1");
  });

  it("reveals the two-step confirm when Stop sharing is clicked", () => {
    render(
      <MemoryRouter>
        <CalendarFeedControls
          organizationId="org-1"
          calendarFeedUrl="https://example.com/api/calendar/feed/token123.ics"
        />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop sharing" }));

    expect(screen.getByRole("button", { name: "Yes, stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    // The "Stop sharing" trigger button itself is gone once confirming.
    expect(screen.queryByRole("button", { name: "Stop sharing" })).toBeNull();
  });
});
