/**
 * What the booking dialogs say about quantity-tracked assets they book at
 * 1 unit.
 *
 * @see {@link file://./quantity-tracked-one-unit-notice.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createAsset } from "@factories";

import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  QuantityTrackedOneUnitNotice,
  quantityTrackedOneUnitMessage,
} from "./quantity-tracked-one-unit-notice";

/** A selected asset index row of the given type. */
const row = (id: string, type: "INDIVIDUAL" | "QUANTITY_TRACKED") => ({
  ...createAsset({ id, type }),
  id,
});
const individual = row("a1", "INDIVIDUAL");
const pool = row("p1", "QUANTITY_TRACKED");
const otherPool = row("p2", "QUANTITY_TRACKED");
const selectAll = { id: ALL_SELECTED_KEY };

describe("quantityTrackedOneUnitMessage", () => {
  it("says nothing when no selected row is quantity-tracked", () => {
    expect(quantityTrackedOneUnitMessage([individual])).toBeNull();
  });

  it("gives the exact count of quantity-tracked rows", () => {
    expect(quantityTrackedOneUnitMessage([individual, pool, otherPool])).toBe(
      "2 quantity-tracked asset(s) in your selection will be booked at 1 unit each. You can change the amount on the booking."
    );
  });

  it("counts only the rows it holds under select all", () => {
    // Neither booking route expands select all, so nothing on other pages is
    // booked and the notice must not speak for it.
    expect(quantityTrackedOneUnitMessage([selectAll])).toBeNull();
    expect(quantityTrackedOneUnitMessage([individual, pool, selectAll])).toBe(
      "1 quantity-tracked asset(s) in your selection will be booked at 1 unit each. You can change the amount on the booking."
    );
  });

  it("leaves out assets that will not be booked", () => {
    // `p1` is already on the chosen booking: it keeps the amount it has.
    expect(quantityTrackedOneUnitMessage([pool, otherPool], ["p1"])).toBe(
      "1 quantity-tracked asset(s) in your selection will be booked at 1 unit each. You can change the amount on the booking."
    );
    expect(quantityTrackedOneUnitMessage([pool], ["p1"])).toBeNull();
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
