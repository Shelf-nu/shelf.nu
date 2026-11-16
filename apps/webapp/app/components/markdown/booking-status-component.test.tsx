/**
 * `BookingStatusComponent`: the `{% booking_status %}` Markdoc tag.
 *
 * Its `status` comes from stored note content, so an injected tag can carry
 * any value. A real status renders the badge; anything else renders as text
 * rather than reaching the badge's colour lookup, which throws on an unknown
 * status and would take down the page around the note.
 *
 * @see {@link file://./booking-status-component.tsx}
 */
import { render, screen } from "@testing-library/react";

import { BookingStatusComponent } from "./booking-status-component";

// why: the badge reads the viewer from the root route loader, which a unit
// test does not mount
vi.mock("~/hooks/use-user-data", () => ({
  useUserData: () => ({ id: "user-1" }),
}));

// why: the badge reads workspace booking settings from a route loader, which
// a unit test does not mount
vi.mock("~/hooks/use-reservation-is-request", () => ({
  useReservationIsRequest: () => false,
}));

describe("BookingStatusComponent", () => {
  it("renders an unknown status as plain text instead of throwing", () => {
    let container: HTMLElement | undefined;
    expect(() => {
      container = render(<BookingStatusComponent status="INVALID" />).container;
    }).not.toThrow();
    expect(screen.getByText("INVALID")).toBeInTheDocument();
    expect(
      (container?.firstElementChild as HTMLElement).style.backgroundColor
    ).toBe("");
  });

  it("renders a numeric status from an injected tag as text", () => {
    render(<BookingStatusComponent status={1 as unknown as string} />);

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("still renders the badge for a real booking status", () => {
    const { container } = render(<BookingStatusComponent status="COMPLETE" />);

    // The badge carries its status colour; the plain-text fallback does not.
    const badge = container.firstElementChild as HTMLElement;
    expect(badge.style.backgroundColor).not.toBe("");
    expect(badge.textContent).toBe("COMPLETE");
  });
});
