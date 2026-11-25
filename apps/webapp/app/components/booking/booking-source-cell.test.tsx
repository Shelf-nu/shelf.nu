/**
 * Booking source cell tests: when a pool slice's Location cell shows its
 * sources, and what a single source, a split, a short source and an
 * unassigned source render.
 *
 * @see {@link file://./booking-source-cell.tsx}
 */

import type { BookingSourcePart } from "@shelf/quantity-control";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BookingSourceCell,
  isStandalonePoolSlice,
  selectPoolSourceCell,
} from "./booking-source-cell";

// why: LocationBadge needs the `_layout` route loader (roles) and the location
// tree API, neither mounted here; a double that records the location it was
// handed proves the cell chose the badge and what it passed.
vi.mock("../location/location-badge", () => ({
  LocationBadge: ({
    location,
  }: {
    location?: { id: string; name: string; parentId?: string | null } | null;
  }) => (
    <span
      data-testid="location-badge"
      data-location-id={location?.id}
      data-parent-id={location?.parentId ?? ""}
    >
      {location?.name}
    </span>
  ),
}));

afterEach(() => {
  cleanup();
});

/** Builds a display part with neutral defaults. */
function part(overrides: Partial<BookingSourcePart>): BookingSourcePart {
  return {
    key: "LOCATION:loc-a",
    kind: "LOCATION",
    locationId: "loc-a",
    label: "Demo Warehouse",
    planned: 8,
    out: 0,
    short: false,
    ...overrides,
  };
}

const WAREHOUSE = part({});
const UNPLACED = part({
  key: "UNPLACED",
  kind: "UNPLACED",
  locationId: null,
  label: "Unplaced",
  planned: 7,
  out: 2,
});
const UNASSIGNED = part({
  key: "UNASSIGNED",
  kind: "UNASSIGNED",
  locationId: null,
  label: "Needs a location",
  planned: 3,
  short: true,
});

describe("selectPoolSourceCell", () => {
  const base = {
    isStandalonePoolSlice: true,
    hasManualPlacements: true,
  };

  it("returns the parts of an allocated standalone pool slice", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [WAREHOUSE], mode: "AUTO" },
      })
    ).toEqual({ parts: [WAREHOUSE] });
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [WAREHOUSE, UNPLACED], mode: "MANUAL" },
      })
    ).toEqual({ parts: [WAREHOUSE, UNPLACED] });
  });

  it("keeps the ordinary cell for LEGACY and KIT slices", () => {
    for (const mode of ["LEGACY", "KIT"] as const) {
      expect(
        selectPoolSourceCell({
          ...base,
          summary: { parts: [WAREHOUSE], mode },
        })
      ).toBeNull();
    }
  });

  it("keeps the ordinary cell for individual assets and kit rows", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        isStandalonePoolSlice: false,
        summary: { parts: [WAREHOUSE], mode: "AUTO" },
      })
    ).toBeNull();
    expect(selectPoolSourceCell({ ...base, summary: undefined })).toBeNull();
  });

  it("keeps the ordinary cell when there is nothing to show", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [], mode: "AUTO" },
      })
    ).toBeNull();
  });

  it("keeps the ordinary cell for a pool without manual placements drawing from Unplaced", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        hasManualPlacements: false,
        summary: { parts: [UNPLACED], mode: "AUTO" },
      })
    ).toBeNull();
  });

  it("still shows a pool without manual placements that needs a location", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        hasManualPlacements: false,
        summary: { parts: [UNASSIGNED], mode: "AUTO" },
      })
    ).toEqual({ parts: [UNASSIGNED] });
  });
});

describe("isStandalonePoolSlice", () => {
  it("counts a quantity-tracked slice with no live kit", () => {
    expect(
      isStandalonePoolSlice({
        asset: { type: "QUANTITY_TRACKED" },
        assetKitId: null,
      })
    ).toBe(true);
  });

  it("counts units left behind when the asset left its kit", () => {
    // `sourceKitId` is provenance only; the slice is AUTO and standalone.
    expect(
      isStandalonePoolSlice({
        asset: { type: "QUANTITY_TRACKED" },
        assetKitId: null,
        sourceKitId: "kit-1",
      } as { asset: { type: string }; assetKitId: string | null })
    ).toBe(true);
  });

  it("rejects kit-driven slices and individual assets", () => {
    expect(
      isStandalonePoolSlice({
        asset: { type: "QUANTITY_TRACKED" },
        assetKitId: "ak-1",
      })
    ).toBe(false);
    expect(
      isStandalonePoolSlice({ asset: { type: "INDIVIDUAL" }, assetKitId: null })
    ).toBe(false);
  });
});

describe("BookingSourceCell", () => {
  it("renders a single location source as its location badge", () => {
    render(<BookingSourceCell cell={{ parts: [WAREHOUSE] }} />);

    const badge = screen.getByTestId("location-badge");
    expect(badge).toHaveTextContent("Demo Warehouse");
    expect(badge).toHaveAttribute("data-location-id", "loc-a");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Short at/)).not.toBeInTheDocument();
  });

  it("keeps the row location's hierarchy when the single source is that location", () => {
    render(
      <BookingSourceCell
        cell={{ parts: [WAREHOUSE] }}
        rowLocation={{
          id: "loc-a",
          name: "Demo Warehouse",
          parentId: "loc-root",
          _count: { children: 0 },
        }}
      />
    );

    expect(screen.getByTestId("location-badge")).toHaveAttribute(
      "data-parent-id",
      "loc-root"
    );
  });

  it("shows Needs a location for units left behind by a kit", () => {
    const slice = {
      asset: { type: "QUANTITY_TRACKED" },
      assetKitId: null,
      sourceKitId: "kit-1",
    };
    const cell = selectPoolSourceCell({
      summary: { parts: [UNASSIGNED], mode: "AUTO" },
      isStandalonePoolSlice: isStandalonePoolSlice(slice),
      hasManualPlacements: true,
    });
    expect(cell).not.toBeNull();
    if (!cell) return;

    render(<BookingSourceCell cell={cell} />);

    expect(screen.getByText("Needs a location")).toBeInTheDocument();
  });

  it("renders a single non-location source by its label", () => {
    render(<BookingSourceCell cell={{ parts: [{ ...UNPLACED, out: 0 }] }} />);

    expect(screen.getByText("Unplaced")).toBeInTheDocument();
  });

  it("renders a split as one wrapping summary line", () => {
    render(<BookingSourceCell cell={{ parts: [WAREHOUSE, UNPLACED] }} />);

    const trigger = screen.getByRole("button", {
      name: "Demo Warehouse 8 · Unplaced 7",
    });
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger.className).toMatch(/whitespace-normal/);
  });

  it("lists planned and out units per source in the split tooltip", async () => {
    render(<BookingSourceCell cell={{ parts: [WAREHOUSE, UNPLACED] }} />);

    await userEvent.hover(
      screen.getByRole("button", { name: "Demo Warehouse 8 · Unplaced 7" })
    );
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toMatch(/Demo Warehouse: 8 planned, 0 out/);
    expect(tooltip.textContent).toMatch(/Unplaced: 7 planned, 2 out/);
  });

  it("keeps the split tooltip trigger keyboard-focusable and described while open", async () => {
    render(<BookingSourceCell cell={{ parts: [WAREHOUSE, UNPLACED] }} />);
    const trigger = screen.getByRole("button", {
      name: "Demo Warehouse 8 · Unplaced 7",
    });

    await userEvent.tab();
    expect(trigger).toHaveFocus();

    // Opens on focus alone, before any hover.
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toMatch(/Unplaced: 7 planned, 2 out/);
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("flags a short source by name", () => {
    render(
      <BookingSourceCell
        cell={{ parts: [{ ...WAREHOUSE, short: true }, UNPLACED] }}
      />
    );

    expect(screen.getByText("Short at Demo Warehouse")).toBeInTheDocument();
    expect(screen.queryByText("Short at Unplaced")).not.toBeInTheDocument();
  });

  it("flags a short single source too", () => {
    render(
      <BookingSourceCell cell={{ parts: [{ ...WAREHOUSE, short: true }] }} />
    );

    expect(screen.getByText("Demo Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Short at Demo Warehouse")).toBeInTheDocument();
  });

  it("shows Needs a location for unassigned units without a second flag", () => {
    render(<BookingSourceCell cell={{ parts: [UNASSIGNED] }} />);

    expect(screen.getByText("Needs a location")).toBeInTheDocument();
    expect(screen.queryByText(/Short at/)).not.toBeInTheDocument();
  });
});
