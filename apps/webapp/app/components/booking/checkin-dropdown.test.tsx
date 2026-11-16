/**
 * Tests for {@link CheckinDropdown} with the real menu hook: the menu opens
 * from the keyboard on desktop, one mouse click opens it exactly once, and
 * Quick check-in opens its dialog by keyboard or mouse and keeps it open once
 * the menu closes.
 *
 * @see {@link file://./checkin-dropdown.tsx}
 * @see {@link file://../../hooks/use-controlled-dropdown-menu.ts}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import type { Window as HappyDOMWindow } from "happy-dom";
import { MemoryRouter, useNavigation } from "react-router";
import { describe, expect, it, vi } from "vitest";

import CheckinDropdown from "./checkin-dropdown";

// why: the menu hook reads `?ref=qr` through the app's search-param helpers,
// which need a data router's loader data. No QR scan is under test.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams()] as const,
}));

// why: `useDisabled` reads `useNavigation`, which needs a data router; the
// MemoryRouter here only serves the Explicit check-in link.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigation: vi.fn(() => ({ state: "idle" })),
  };
});

// why: `DateS` reads the user's format preferences from the root loader data,
// which this component test does not mount. The dates are not under test.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: Date | string }) => (
    <span>{new Date(date).toISOString()}</span>
  ),
}));

/** A booking that ended an hour ago, so no early check-in prompt applies. */
const booking = {
  id: "booking-1",
  name: "Studio shoot",
  from: new Date(Date.now() - 3 * 60 * 60 * 1000),
  to: new Date(Date.now() - 60 * 60 * 1000),
};

/** Renders the control at desktop width, where the menu is a dropdown. */
function renderDropdown() {
  (window as unknown as HappyDOMWindow).happyDOM.setViewport({
    width: 1024,
    height: 900,
  });
  return render(
    <MemoryRouter>
      <CheckinDropdown booking={booking} formId="booking-form" />
    </MemoryRouter>
  );
}

/** The desktop menu trigger (the mobile one has no menu popup). */
function menuTrigger() {
  return screen
    .getAllByRole("button", { name: /Check-in/ })
    .find((button) => button.getAttribute("aria-haspopup") === "menu")!;
}

/** Opens the menu with Enter on its trigger, the keyboard path. */
function openMenuByKeyboard() {
  const trigger = menuTrigger();
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("CheckinDropdown", () => {
  it.each(["Enter", " ", "ArrowDown"])(
    "opens the menu from the keyboard with %j",
    (key) => {
      renderDropdown();
      const trigger = menuTrigger();
      trigger.focus();

      fireEvent.keyDown(trigger, { key });

      expect(screen.getByRole("menu")).toBeInTheDocument();
    }
  );

  it("opens the menu once per mouse click", () => {
    renderDropdown();
    const trigger = menuTrigger();

    // A real click is a pointerdown followed by a click on the same button.
    fireEvent.pointerDown(trigger, { button: 0, pointerType: "mouse" });
    fireEvent.click(trigger);

    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes the menu with Escape", () => {
    renderDropdown();
    openMenuByKeyboard();

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("opens Quick check-in from the keyboard and keeps it open once the menu closes", () => {
    renderDropdown();
    openMenuByKeyboard();

    const row = screen.getByRole("menuitem", { name: /Quick check-in/ });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByRole("alertdialog", { name: "Check in booking" })
    ).toBeInTheDocument();
  });

  it("opens Quick check-in with the mouse and keeps it open once the menu closes", () => {
    renderDropdown();
    openMenuByKeyboard();

    fireEvent.click(screen.getByRole("button", { name: /Quick check-in/ }));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(
      screen.getByRole("alertdialog", { name: "Check in booking" })
    ).toBeInTheDocument();
  });

  it("blocks Quick check-in while a submission is in flight and says so", () => {
    // why: an in-flight submission is the state under test, and the file
    // already mocks `useNavigation` for the data-router dependency.
    vi.mocked(useNavigation).mockReturnValue({ state: "submitting" } as never);
    try {
      renderDropdown();
      openMenuByKeyboard();

      const row = screen.getByRole("menuitem", { name: /Quick check-in/ });
      expect(row).toHaveAttribute("aria-disabled", "true");
      row.focus();
      fireEvent.keyDown(row, { key: "Enter" });

      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    } finally {
      vi.mocked(useNavigation).mockReturnValue({ state: "idle" } as never);
    }
  });
});
