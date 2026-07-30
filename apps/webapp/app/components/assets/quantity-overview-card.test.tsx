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
});
