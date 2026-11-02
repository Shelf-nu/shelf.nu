/**
 * Tests for the Archive and Duplicate booking actions: both address the
 * booking by its own id, so they work from any page.
 *
 * @see {@link file://./archive-booking-action.tsx}
 * @see {@link file://./duplicate-booking-action.tsx}
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ArchiveBookingAction } from "./archive-booking-action";
import { DuplicateBookingAction } from "./duplicate-booking-action";

const submit = vi.fn();

// why: the real `useFetcher` needs a data router, which a component test does
// not mount; the submit call is what is asserted. `Link` renders as an anchor.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    useNavigation: () => ({ state: "idle" }),
    useFetcher: () => ({ state: "idle", data: undefined, submit }),
    Link: ({ to, children, ...props }: { to: string; children?: unknown }) => (
      <a href={to} {...props}>
        {children as never}
      </a>
    ),
  };
});

describe("ArchiveBookingAction", () => {
  it("submits intent=archive to /bookings/b1/overview", () => {
    render(<ArchiveBookingAction booking={{ id: "b1" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    expect(submit).toHaveBeenCalledWith(
      { intent: "archive" },
      { method: "post", action: "/bookings/b1/overview" }
    );
  });
});

describe("DuplicateBookingAction", () => {
  it("links to /bookings/b1/overview/duplicate", () => {
    render(<DuplicateBookingAction booking={{ id: "b1" }} />);

    expect(
      screen
        .getByRole("link", { name: "Duplicate booking" })
        .getAttribute("href")
    ).toBe("/bookings/b1/overview/duplicate");
  });
});
