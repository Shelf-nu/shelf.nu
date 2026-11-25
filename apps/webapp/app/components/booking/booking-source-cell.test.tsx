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
import { BookingSourceCell, selectPoolSourceCell } from "./booking-source-cell";

// why: LocationBadge reads the member's roles from the `_layout` route loader,
// which is not mounted here; no roles renders the plain badge without the
// hierarchy popover and its API fetch.
vi.mock("~/hooks/use-organization-roles", () => ({
  useOrganizationRoles: () => undefined,
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
        summary: { parts: [WAREHOUSE], short: false, mode: "AUTO" },
      })
    ).toEqual({ parts: [WAREHOUSE], short: false });
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [WAREHOUSE, UNPLACED], short: true, mode: "MANUAL" },
      })
    ).toEqual({ parts: [WAREHOUSE, UNPLACED], short: true });
  });

  it("keeps the ordinary cell for LEGACY and KIT slices", () => {
    for (const mode of ["LEGACY", "KIT"]) {
      expect(
        selectPoolSourceCell({
          ...base,
          summary: { parts: [WAREHOUSE], short: false, mode },
        })
      ).toBeNull();
    }
  });

  it("keeps the ordinary cell for individual assets and kit rows", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        isStandalonePoolSlice: false,
        summary: { parts: [WAREHOUSE], short: false, mode: "AUTO" },
      })
    ).toBeNull();
    expect(selectPoolSourceCell({ ...base, summary: undefined })).toBeNull();
  });

  it("keeps the ordinary cell when there is nothing to show", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        summary: { parts: [], short: false, mode: "AUTO" },
      })
    ).toBeNull();
  });

  it("keeps the ordinary cell for a pool without manual placements drawing from Unplaced", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        hasManualPlacements: false,
        summary: { parts: [UNPLACED], short: false, mode: "AUTO" },
      })
    ).toBeNull();
  });

  it("still shows a pool without manual placements that needs a location", () => {
    expect(
      selectPoolSourceCell({
        ...base,
        hasManualPlacements: false,
        summary: { parts: [UNASSIGNED], short: true, mode: "AUTO" },
      })
    ).toEqual({ parts: [UNASSIGNED], short: true });
  });
});

describe("BookingSourceCell", () => {
  it("renders a single location source as its location badge", () => {
    render(<BookingSourceCell cell={{ parts: [WAREHOUSE], short: false }} />);

    expect(screen.getByText("Demo Warehouse")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(/Short at/)).not.toBeInTheDocument();
  });

  it("renders a single non-location source by its label", () => {
    render(
      <BookingSourceCell
        cell={{ parts: [{ ...UNPLACED, out: 0 }], short: false }}
      />
    );

    expect(screen.getByText("Unplaced")).toBeInTheDocument();
  });

  it("renders a split as one wrapping summary line", () => {
    render(
      <BookingSourceCell
        cell={{ parts: [WAREHOUSE, UNPLACED], short: false }}
      />
    );

    const trigger = screen.getByRole("button", {
      name: "Demo Warehouse 8 · Unplaced 7",
    });
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger.className).toMatch(/whitespace-normal/);
  });

  it("lists planned and out units per source in the split tooltip", async () => {
    render(
      <BookingSourceCell
        cell={{ parts: [WAREHOUSE, UNPLACED], short: false }}
      />
    );

    await userEvent.hover(
      screen.getByRole("button", { name: "Demo Warehouse 8 · Unplaced 7" })
    );
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip.textContent).toMatch(/Demo Warehouse: 8 planned, 0 out/);
    expect(tooltip.textContent).toMatch(/Unplaced: 7 planned, 2 out/);
  });

  it("keeps the split tooltip trigger keyboard-focusable and described while open", async () => {
    render(
      <BookingSourceCell
        cell={{ parts: [WAREHOUSE, UNPLACED], short: false }}
      />
    );
    const trigger = screen.getByRole("button", {
      name: "Demo Warehouse 8 · Unplaced 7",
    });

    await userEvent.tab();
    expect(trigger).toHaveFocus();

    await userEvent.hover(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
  });

  it("flags a short source by name", () => {
    render(
      <BookingSourceCell
        cell={{
          parts: [{ ...WAREHOUSE, short: true }, UNPLACED],
          short: true,
        }}
      />
    );

    expect(screen.getByText("Short at Demo Warehouse")).toBeInTheDocument();
    expect(screen.queryByText("Short at Unplaced")).not.toBeInTheDocument();
  });

  it("flags a short single source too", () => {
    render(
      <BookingSourceCell
        cell={{ parts: [{ ...WAREHOUSE, short: true }], short: true }}
      />
    );

    expect(screen.getByText("Demo Warehouse")).toBeInTheDocument();
    expect(screen.getByText("Short at Demo Warehouse")).toBeInTheDocument();
  });

  it("shows Needs a location for unassigned units without a second flag", () => {
    render(<BookingSourceCell cell={{ parts: [UNASSIGNED], short: true }} />);

    expect(screen.getByText("Needs a location")).toBeInTheDocument();
    expect(screen.queryByText(/Short at/)).not.toBeInTheDocument();
  });
});
