/**
 * QuantityOverviewCard — unit tests
 *
 * Covers the Task 7 UX addition: an `InfoTooltip` next to the
 * "Reserved (bookings)" row explaining that reserved units are committed to
 * FUTURE bookings and therefore do NOT reduce the headline "Available"
 * figure (which now reflects current physical stock only — see #2724 and
 * `quantity-overview.server.test.ts` for the headline-mapping regression
 * test).
 *
 * @see {@link file://./quantity-overview-card.tsx}
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuantityOverviewCard } from "./quantity-overview-card";

// why: Radix Tooltip content lives in a Portal that only mounts on
// hover/focus in a real browser; Happy DOM doesn't simulate that timing.
// Rendering the trigger/content inline (same pattern as
// `~/components/list/filters/sort-by.test.tsx`) lets the test assert on the
// tooltip copy directly instead of simulating a hover interaction.
vi.mock("~/components/shared/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

/**
 * Matches the (whitespace-collapsed) direct text content of an element
 * against every expected substring. Using substring containment rather than
 * one long exact string keeps the test resilient to incidental JSX
 * whitespace/line-wrap changes in the tooltip copy while still pinning down
 * the values that actually matter: the reserved count, the unit, and the
 * booking-count pluralization.
 */
function textContaining(...expectedSubstrings: string[]) {
  return (text: string) => expectedSubstrings.every((s) => text.includes(s));
}

describe("QuantityOverviewCard", () => {
  const baseProps = {
    assetId: "asset-1",
    quantity: 10,
    unitOfMeasure: null,
    minQuantity: null,
    consumptionType: null,
  };

  it("shows the reserved-bookings tooltip explaining current-state semantics", () => {
    render(
      <QuantityOverviewCard
        {...baseProps}
        availableQuantity={10}
        reservedQuantity={14}
        reservingBookingCount={2}
      />
    );

    expect(screen.getByText("Reserved (bookings)")).toBeInTheDocument();
    expect(
      screen.getByText(
        textContaining(
          "14",
          "units",
          "reserved across",
          "2",
          "upcoming",
          "bookings",
          "committed for future dates",
          "don't reduce",
          "physically on the shelf now"
        )
      )
    ).toBeInTheDocument();
  });

  it("pluralizes a singular booking count as 'booking', not 'bookings'", () => {
    render(
      <QuantityOverviewCard
        {...baseProps}
        availableQuantity={10}
        reservedQuantity={5}
        reservingBookingCount={1}
      />
    );

    expect(
      screen.getByText(textContaining("1", "upcoming booking."))
    ).toBeInTheDocument();
    // Guard the negative case explicitly: "1 upcoming bookings" must not appear.
    expect(screen.queryByText(textContaining("upcoming bookings"))).toBeNull();
  });

  it("uses the asset's unit of measure in the tooltip copy when set", () => {
    render(
      <QuantityOverviewCard
        {...baseProps}
        unitOfMeasure="boards"
        availableQuantity={10}
        reservedQuantity={7}
        reservingBookingCount={2}
      />
    );

    expect(
      screen.getByText(textContaining("7", "boards", "reserved across"))
    ).toBeInTheDocument();
  });

  it("does not render the reserved row or tooltip when nothing is reserved", () => {
    render(
      <QuantityOverviewCard
        {...baseProps}
        availableQuantity={10}
        reservedQuantity={0}
        reservingBookingCount={0}
      />
    );

    expect(screen.queryByText("Reserved (bookings)")).not.toBeInTheDocument();
  });

  it("renders the headline Available value from availableQuantity (current physical stock, not the old global-reserved formula)", () => {
    // Regression guard for #2724 at the component boundary: even with a
    // large `reservedQuantity` that would drive the old inline formula
    // (`total - reserved - ...`) negative, the card must render whatever
    // `availableQuantity` it was given verbatim — it must never re-derive
    // "Available" by subtracting `reservedQuantity` itself. `quantity`
    // (Total) and `availableQuantity` (Available) are deliberately
    // different values here so the two rows are unambiguous in the DOM.
    render(
      <QuantityOverviewCard
        {...baseProps}
        quantity={20}
        availableQuantity={10}
        reservedQuantity={14}
        reservingBookingCount={2}
      />
    );

    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("shows the leftover stock as Unplaced when locations hold less than the total", () => {
    render(
      <QuantityOverviewCard
        {...baseProps}
        quantity={100}
        availableQuantity={100}
        inLocationsQuantity={60}
      />
    );

    expect(screen.getByText("Unplaced")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.queryByText("Over-placed")).not.toBeInTheDocument();
  });

  it("reports Over-placed instead of clamping the residual to zero", () => {
    // The production shape: 90 units placed, then 10 consumed off a total of
    // 90 leaves the asset owning 80 while locations still claim 90. The old
    // `Math.max(0, …)` rendered "Unplaced 0", which is a number that was
    // never true and hid the drift from the only person who could fix it.
    render(
      <QuantityOverviewCard
        {...baseProps}
        quantity={80}
        availableQuantity={80}
        inLocationsQuantity={90}
      />
    );

    expect(screen.getByText("Over-placed")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText("Unplaced")).not.toBeInTheDocument();
  });

  it("does not call a kit-driven placement over-placed", () => {
    // 80 manual + 50 kit-driven units of a 100 total is VALID: since
    // `20260602100000_assetlocation_sum_exclude_kit_driven` the location
    // trigger sums manual rows only, and the kit axis is capped separately.
    // Deriving over-placement from the combined 130 would raise a false alarm
    // on a perfectly healthy asset.
    render(
      <QuantityOverviewCard
        {...baseProps}
        quantity={100}
        availableQuantity={100}
        inLocationsQuantity={130}
        inLocationsManualQuantity={80}
        inKitsQuantity={50}
      />
    );

    expect(screen.queryByText("Over-placed")).not.toBeInTheDocument();
  });

  it("exposes the over-placed guidance to keyboard and screen-reader users", () => {
    // The tooltip carries the only copy saying what the row means and how to
    // fix it. Hanging it off a bare SVG made it mouse-only: an <svg> is
    // neither focusable nor announced, so the people most likely to be
    // auditing stock could never reach the instruction.
    render(
      <QuantityOverviewCard
        {...baseProps}
        quantity={80}
        unitOfMeasure="pcs"
        availableQuantity={80}
        inLocationsQuantity={90}
      />
    );

    const trigger = screen.getByRole("button", {
      name: /Locations claim 10 pcs more/,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("tabindex", "-1");
  });

  it("explains what to do about an over-placed asset", () => {
    render(
      <QuantityOverviewCard
        {...baseProps}
        quantity={80}
        unitOfMeasure="pcs"
        availableQuantity={80}
        inLocationsQuantity={90}
      />
    );

    expect(
      screen.getByText(
        textContaining("Locations claim 10 pcs more", "Manage placements")
      )
    ).toBeInTheDocument();
  });
});
