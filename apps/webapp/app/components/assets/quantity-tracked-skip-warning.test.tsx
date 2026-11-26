/**
 * What the bulk dialogs say about quantity-tracked assets they will skip.
 *
 * @see {@link file://./quantity-tracked-skip-warning.tsx}
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  QuantityTrackedSkipWarning,
  quantityTrackedSkipMessage,
} from "./quantity-tracked-skip-warning";

const INSTEAD = "Set their placements on each asset's page.";
const individual = { id: "a1", type: "INDIVIDUAL" };
const pool = { id: "p1", type: "QUANTITY_TRACKED" };
const selectAll = { id: ALL_SELECTED_KEY };

describe("quantityTrackedSkipMessage", () => {
  it("says nothing when no hand-picked row is quantity-tracked", () => {
    expect(quantityTrackedSkipMessage([individual], INSTEAD)).toBeNull();
  });

  it("gives the exact count for hand-picked rows", () => {
    expect(
      quantityTrackedSkipMessage(
        [individual, pool, { ...pool, id: "p2" }],
        INSTEAD
      )
    ).toBe(
      "2 quantity-tracked asset(s) in your selection will be skipped. Set their placements on each asset's page."
    );
  });

  it("warns under select all even when the loaded page holds none", () => {
    // The selection reaches assets on other pages, which the dialog cannot
    // see: staying silent would let them be skipped with no warning.
    expect(quantityTrackedSkipMessage([individual, selectAll], INSTEAD)).toBe(
      "Any quantity-tracked assets in your selection will be skipped. Set their placements on each asset's page."
    );
  });

  it("treats the loaded page's count as a floor under select all", () => {
    expect(
      quantityTrackedSkipMessage([individual, pool, selectAll], INSTEAD)
    ).toBe(
      "Quantity-tracked assets in your selection will be skipped (1 on this page, and any on others). Set their placements on each asset's page."
    );
  });
});

describe("QuantityTrackedSkipWarning", () => {
  it("shows the warning for a select-all selection", () => {
    render(
      <QuantityTrackedSkipWarning
        selectedItems={[individual, pool, selectAll]}
        instead={INSTEAD}
      />
    );

    expect(
      screen.getByText(
        "Quantity-tracked assets in your selection will be skipped (1 on this page, and any on others). Set their placements on each asset's page."
      )
    ).toBeTruthy();
  });

  it("renders nothing when the selection needs no warning", () => {
    const { container } = render(
      <QuantityTrackedSkipWarning
        selectedItems={[individual]}
        instead={INSTEAD}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
