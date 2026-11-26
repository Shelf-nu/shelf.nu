/**
 * What the booking dialogs say about quantity-tracked assets they book at
 * 1 unit.
 *
 * @see {@link file://./quantity-tracked-one-unit-notice.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  QuantityTrackedOneUnitNotice,
  quantityTrackedOneUnitMessage,
} from "./quantity-tracked-one-unit-notice";

const individual = { id: "a1", type: "INDIVIDUAL" };
const pool = { id: "p1", type: "QUANTITY_TRACKED" };
const selectAll = { id: ALL_SELECTED_KEY };

describe("quantityTrackedOneUnitMessage", () => {
  it("says nothing when no hand-picked row is quantity-tracked", () => {
    expect(quantityTrackedOneUnitMessage([individual])).toBeNull();
  });

  it("gives the exact count for hand-picked rows", () => {
    expect(
      quantityTrackedOneUnitMessage([individual, pool, { ...pool, id: "p2" }])
    ).toBe(
      "2 quantity-tracked asset(s) in your selection will be booked at 1 unit each. You can change the amount on the booking."
    );
  });

  it("speaks in general terms under select all, where other pages are not loaded", () => {
    expect(quantityTrackedOneUnitMessage([individual, selectAll])).toBe(
      "Any quantity-tracked assets in your selection will be booked at 1 unit each. You can change the amount on the booking."
    );
    expect(quantityTrackedOneUnitMessage([individual, pool, selectAll])).toBe(
      "Quantity-tracked assets in your selection will be booked at 1 unit each (1 on this page, and any on others). You can change the amount on the booking."
    );
  });
});

describe("QuantityTrackedOneUnitNotice", () => {
  it("shows the notice when the selection holds a quantity-tracked asset", () => {
    render(<QuantityTrackedOneUnitNotice selectedItems={[individual, pool]} />);

    expect(
      screen.getByText(
        "1 quantity-tracked asset(s) in your selection will be booked at 1 unit each. You can change the amount on the booking."
      )
    ).toBeTruthy();
  });

  it("renders nothing when the selection holds none", () => {
    const { container } = render(
      <QuantityTrackedOneUnitNotice selectedItems={[individual]} />
    );

    expect(container.firstChild).toBeNull();
  });
});
