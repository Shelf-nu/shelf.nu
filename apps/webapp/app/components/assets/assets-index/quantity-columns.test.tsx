/**
 * Quantity and Unit of Measure Column UI Tests
 *
 * The advanced asset index shows a quantity-tracked asset's stock as a bare
 * number in Quantity and its unit ("pcs", "kg") in its own Unit of measure
 * column. Individual assets have neither and show the empty-value dash.
 *
 * @see {@link file://./advanced-asset-columns.tsx}
 */
import type { ReactNode } from "react";
import { AssetType } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// why: lottie-web draws on a canvas at import time, which happy-dom lacks
vi.mock("lottie-react", () => ({
  default: () => null,
}));

import { QuantityColumn, UnitOfMeasureColumn } from "./advanced-asset-columns";

/** A quantity-tracked asset counted in pieces. */
const GLOVES = {
  type: AssetType.QUANTITY_TRACKED,
  quantity: 5,
  unitOfMeasure: "pcs",
};
/** An individual asset: no stock count, no unit. */
const DRILL = {
  type: AssetType.INDIVIDUAL,
  quantity: null,
  unitOfMeasure: null,
};

/** Wraps the cell in the table structure a `<td>` needs. */
function renderInRow(cell: ReactNode) {
  return render(
    <table>
      <tbody>
        <tr>{cell}</tr>
      </tbody>
    </table>
  );
}

describe("QuantityColumn", () => {
  it("shows only the number for a quantity-tracked asset", () => {
    renderInRow(<QuantityColumn item={GLOVES} />);

    expect(screen.getByRole("cell")).toHaveTextContent(/^5$/);
  });

  it("shows the empty-value dash for an individual asset", () => {
    renderInRow(<QuantityColumn item={DRILL} />);

    expect(screen.getByLabelText("No data")).toBeInTheDocument();
  });
});

describe("UnitOfMeasureColumn", () => {
  it("shows the unit for a quantity-tracked asset", () => {
    renderInRow(<UnitOfMeasureColumn item={GLOVES} />);

    expect(screen.getByRole("cell")).toHaveTextContent(/^pcs$/);
  });

  it("shows the empty-value dash for a quantity-tracked asset without a unit", () => {
    renderInRow(
      <UnitOfMeasureColumn item={{ ...GLOVES, unitOfMeasure: null }} />
    );

    expect(screen.getByLabelText("No data")).toBeInTheDocument();
  });

  it("shows the empty-value dash for an individual asset", () => {
    renderInRow(<UnitOfMeasureColumn item={DRILL} />);

    expect(screen.getByLabelText("No data")).toBeInTheDocument();
  });
});
