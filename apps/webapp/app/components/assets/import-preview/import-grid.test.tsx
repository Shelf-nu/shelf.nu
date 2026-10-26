/**
 * ImportGrid - unit tests
 *
 * Covers the rendering contract of the generic import preview grid: one row
 * per entry with its label first, the struck-through previous value, the
 * truncation footer and its "Load more" button, the warning tone and the
 * hover tooltip.
 *
 * @see {@link file://./import-grid.tsx}
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

/** Renders the grid over {@link ROWS}, or `overrides.rows`. */
function renderGrid(
  overrides: {
    rows?: ImportGridRow[];
    totalRows?: number;
    onLoadMore?: () => void;
    isLoadingMore?: boolean;
  } = {}
) {
  const rows = overrides.rows ?? ROWS;
  return render(
    <ImportGrid
      columns={["Title", "Category"]}
      rows={rows}
      totalRows={overrides.totalRows ?? rows.length}
      onLoadMore={overrides.onLoadMore}
      isLoadingMore={overrides.isLoadingMore}
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
    const { unmount } = renderGrid({ totalRows: 1965 });
    expect(screen.getByText("Showing 2 of 1,965 rows")).toBeInTheDocument();
    // Without a loader the footer is a note only.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    unmount();

    renderGrid();
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it("offers to load the next page, capped at the rows left", () => {
    const onLoadMore = vi.fn();
    const { unmount } = renderGrid({ totalRows: 965, onLoadMore });

    fireEvent.click(screen.getByRole("button", { name: "Load 100 more" }));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    unmount();

    renderGrid({ totalRows: 30, onLoadMore });
    expect(
      screen.getByRole("button", { name: "Load 28 more" })
    ).toBeInTheDocument();
  });

  it("disables the load button while the next page loads", () => {
    renderGrid({ totalRows: 965, onLoadMore: vi.fn(), isLoadingMore: true });

    expect(screen.getByRole("button", { name: "Loading..." })).toBeDisabled();
  });

  it("tints a warning cell and its note with the warning palette", () => {
    renderGrid({
      rows: [
        {
          key: "r2",
          label: "Row 2",
          cells: {
            Title: {
              value: "example.com/abc",
              tone: "warning",
              note: "Looks like a web address",
            },
          },
        },
      ],
    });

    const cell = screen.getByText("example.com/abc").closest("td")!;
    expect(cell).toHaveClass("bg-warning-50");
    expect(screen.getByText("example.com/abc")).toHaveClass("text-warning-700");
    expect(screen.getByText("Looks like a web address")).toHaveClass(
      "text-warning-700"
    );
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
