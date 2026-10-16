/**
 * MappingReview: the import mapping table.
 *
 * Covers what the user relies on before pressing Import: every column shows
 * its destination, a clash is flagged on each clashing row, new custom fields
 * are marked, picking a destination reports it, and the summary line follows
 * the mapping.
 *
 * @see {@link file://./mapping-review.tsx}
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ColumnMapping } from "~/modules/import-mapping/types";
import { MappingReview, describeSummary } from "./mapping-review";

const COLUMNS: ColumnMapping[] = [
  {
    source: "Item Name",
    target: { kind: "field", name: "title" },
    confidence: "high",
    sample: ["Dell Latitude"],
  },
  {
    source: "Serial No.",
    target: { kind: "customField", name: "Serial number", type: "TEXT" },
    confidence: "high",
    sample: ["5CG31"],
  },
  {
    source: "Legacy ID",
    target: { kind: "skip" },
    confidence: "low",
    sample: ["X-1"],
  },
];

const SUMMARY = {
  rows: 2,
  newCustomFields: ["Serial number"],
  newCategories: 0,
  newLocations: 1,
};

function renderReview(
  overrides: Partial<Parameters<typeof MappingReview>[0]> = {}
) {
  const onChange = vi.fn();
  render(
    <MappingReview
      columns={COLUMNS}
      onChange={onChange}
      duplicateRows={new Set()}
      existingCustomFields={[]}
      canUseBarcodes={false}
      notes={[]}
      summary={SUMMARY}
      alreadyMatches={false}
      {...overrides}
    />
  );
  return { onChange };
}

describe("MappingReview", () => {
  it("shows every column with its sample and destination", () => {
    renderReview();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Dell Latitude")).toBeTruthy();
    expect(
      within(rows[0]).getByRole("button", {
        name: "Shelf field for column Item Name: Title",
      })
    ).toBeTruthy();
    expect(within(rows[2]).getByText("Guess, please check")).toBeTruthy();
  });

  it("marks a custom field the workspace does not have as new", () => {
    renderReview();
    const serialRow = screen.getAllByRole("row")[2];
    expect(within(serialRow).getByText("New")).toBeTruthy();
  });

  it("locks the type of a custom field the workspace already has", () => {
    renderReview({
      existingCustomFields: [{ name: "serial number", type: "TEXT" }],
    });
    const serialRow = screen.getAllByRole("row")[2];
    expect(within(serialRow).queryByText("New")).toBeNull();
    expect(
      within(serialRow).getByText("Uses your existing field's type")
    ).toBeTruthy();
  });

  it("flags every row of a clash", () => {
    renderReview({ duplicateRows: new Set([0, 2]) });
    expect(
      screen.getAllByText(/Another column already goes to this field/)
    ).toHaveLength(2);
  });

  it("reports the destination the user picks", async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview();
    await user.click(
      screen.getByRole("button", {
        name: "Shelf field for column Legacy ID: Skip",
      })
    );
    await user.click(screen.getByRole("option", { name: /^Location/ }));
    expect(onChange).toHaveBeenCalledWith(2, {
      kind: "field",
      name: "location",
    });
  });

  it("hides barcode fields without the add-on", async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(
      screen.getByRole("button", {
        name: "Shelf field for column Legacy ID: Skip",
      })
    );
    expect(screen.queryByRole("option", { name: /Barcode/ })).toBeNull();
  });

  it("says when the file already matches", () => {
    renderReview({ alreadyMatches: true });
    expect(screen.getByRole("status").textContent).toBe(
      "Your file already matches Shelf's format."
    );
  });
});

describe("describeSummary", () => {
  it("names rows and everything that will be created", () => {
    expect(describeSummary(SUMMARY)).toBe(
      '2 assets will be imported. New: custom field "Serial number" and 1 location.'
    );
    expect(
      describeSummary({
        rows: 1,
        newCustomFields: [],
        newCategories: 0,
        newLocations: 0,
      })
    ).toBe("1 asset will be imported.");
  });
});
