/**
 * ImportGrid - unit tests
 *
 * Covers the rendering contract of the generic import preview grid: one row
 * per entry with its label first, the struck-through previous value, the
 * truncation footer and the hover tooltip.
 *
 * @see {@link file://./import-grid.tsx}
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ImportGridRow } from "~/modules/asset-import/types";
import { ImportGrid } from "./import-grid";

const LEGEND = [
  { tone: "changed" as const, label: "Changed" },
  { tone: "plain" as const, label: "No change" },
];

const ROWS: ImportGridRow[] = [
  {
    key: "r2",
    label: "Row 2",
    cells: {
      Title: { value: "Drill", previous: "Old drill", tone: "changed" },
      Category: {
        value: "Power tools",
        tone: "new",
        note: "Will be created",
      },
    },
  },
  {
    key: "r3",
    label: "Row 3",
    cells: { Title: { value: "Saw", tone: "plain" } },
  },
];

function renderGrid(overrides: { totalRows?: number } = {}) {
  return render(
    <ImportGrid
      columns={["Title", "Category"]}
      rows={ROWS}
      totalRows={overrides.totalRows ?? ROWS.length}
      caption="2 rows"
      legend={LEGEND}
    />
  );
}

describe("ImportGrid", () => {
  it("renders one body row per entry with the label first", () => {
    renderGrid();

    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);
    expect(within(bodyRows[0]).getAllByRole("cell")[0]).toHaveTextContent(
      "Row 2"
    );
    expect(within(bodyRows[1]).getAllByRole("cell")[0]).toHaveTextContent(
      "Row 3"
    );
  });

  it("renders the previous value struck through when set", () => {
    renderGrid();

    const previous = screen.getByText("Old drill");
    expect(previous).toHaveClass("line-through");
    expect(screen.queryByText("Saw")?.nextSibling).toBeNull();
  });

  it("shows the truncation footer only when rows are cut off", () => {
    const { unmount } = renderGrid({ totalRows: 965 });
    expect(
      screen.getByText("Showing the first 2 of 965 rows")
    ).toBeInTheDocument();
    unmount();

    renderGrid();
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });

  it("reveals the note of a new cell as a tooltip on hover", () => {
    renderGrid();

    expect(screen.queryByText("Will be created")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByText("Power tools").closest("td")!);

    expect(screen.getByRole("tooltip")).toHaveTextContent("Will be created");
  });

  it("renders the legend labels", () => {
    renderGrid();

    expect(screen.getByText("Changed")).toBeInTheDocument();
    expect(screen.getByText("No change")).toBeInTheDocument();
  });
});
