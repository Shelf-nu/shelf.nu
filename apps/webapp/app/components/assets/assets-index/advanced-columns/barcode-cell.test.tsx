/**
 * BarcodeCell — unit tests
 *
 * Pins the layout contract that keeps advanced-index rows one line tall:
 *  - Only the first `MAX_VISIBLE_BARCODES` chips render inline; the rest
 *    collapse into a single `+N` control.
 *  - The chip container never wraps (`flex-wrap` here is what stretched the
 *    whole table row when an asset carried many barcodes).
 *  - Barcodes of other types never leak into a type's column.
 *  - Assets with no barcode of the column's type render the empty value.
 *
 * @see {@link file://./barcode-cell.tsx}
 */

import type { ReactElement } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "~/components/shared/tooltip";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import { BarcodeCell } from "./barcode-cell";

// why: CodePreviewDialog fetches through useApiQuery (needs a router context)
// and is not under test — render only its trigger so the assertions stay on
// the cell's own overflow logic.
vi.mock("~/components/code-preview/code-preview-dialog", () => ({
  CodePreviewDialog: ({ trigger }: { trigger: ReactElement }) => trigger,
}));

/** Minimal asset row — the cell only reads identity fields plus `barcodes`. */
function buildAsset(
  barcodes: { id: string; type: string; value: string }[]
): AdvancedIndexAsset {
  return {
    id: "asset-1",
    title: "Tokina 16-28mm",
    qrId: "tct1af4a5n",
    sequentialId: "SAM-0903",
    barcodes,
  } as unknown as AdvancedIndexAsset;
}

function renderCell(asset: AdvancedIndexAsset) {
  return render(
    <TooltipProvider>
      <table>
        <tbody>
          <tr>
            <BarcodeCell
              column="barcode_Code128"
              item={asset}
              workspacePreference="Code128"
            />
          </tr>
        </tbody>
      </table>
    </TooltipProvider>
  );
}

describe("BarcodeCell", () => {
  it("renders every barcode inline when the count is within the cap", () => {
    renderCell(
      buildAsset([
        { id: "b1", type: "Code128", value: "AAA-111" },
        { id: "b2", type: "Code128", value: "BBB-222" },
      ])
    );

    expect(screen.getByText("AAA-111")).toBeTruthy();
    expect(screen.getByText("BBB-222")).toBeTruthy();
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("collapses barcodes beyond the cap into a single +N control", () => {
    renderCell(
      buildAsset([
        { id: "b1", type: "Code128", value: "AAA-111" },
        { id: "b2", type: "Code128", value: "BBB-222" },
        { id: "b3", type: "Code128", value: "CCC-333" },
        { id: "b4", type: "Code128", value: "DDD-444" },
        { id: "b5", type: "Code128", value: "EEE-555" },
      ])
    );

    // Two chips inline …
    expect(screen.getByText("AAA-111")).toBeTruthy();
    expect(screen.getByText("BBB-222")).toBeTruthy();

    // … and one control standing in for the other three.
    expect(screen.getByText("+3")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Show 3 more codes for Tokina 16-28mm",
      })
    ).toBeTruthy();
  });

  it("keeps the chip row on a single line regardless of barcode count", () => {
    const { container } = renderCell(
      buildAsset(
        Array.from({ length: 12 }, (_, index) => ({
          id: `b${index}`,
          type: "Code128",
          value: `CODE-${index}`,
        }))
      )
    );

    const chipRow = container.querySelector("td > div");

    // The regression this file exists for: a wrapping container turns N
    // barcodes into N lines and stretches the height of the entire row.
    expect(chipRow?.className).not.toContain("flex-wrap");
    // At most 2 chips + 1 overflow control can ever be in the row.
    expect(chipRow?.childElementCount).toBe(3);
  });

  it("ignores barcodes belonging to a different type's column", () => {
    renderCell(
      buildAsset([
        { id: "b1", type: "Code128", value: "AAA-111" },
        { id: "b2", type: "Code39", value: "ZZZ-999" },
        { id: "b3", type: "EAN13", value: "1234567890128" },
      ])
    );

    expect(screen.getByText("AAA-111")).toBeTruthy();
    expect(screen.queryByText("ZZZ-999")).toBeNull();
    expect(screen.queryByText("1234567890128")).toBeNull();
    // One matching barcode is under the cap, so no overflow control.
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("renders the empty value when the asset has no barcode of this type", () => {
    renderCell(buildAsset([{ id: "b1", type: "Code39", value: "ZZZ-999" }]));

    expect(screen.queryByText("ZZZ-999")).toBeNull();
    expect(screen.getByLabelText("No data")).toBeTruthy();
  });
});
