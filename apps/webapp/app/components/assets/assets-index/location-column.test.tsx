/**
 * Location Column UI Tests
 *
 * Behavior tests for the multi-location rendering on the advanced asset
 * index. A QUANTITY_TRACKED asset can be placed at multiple locations
 * with different per-location quantities; the column shows the primary
 * location plus a "+N more" affordance whose hover tooltip lists every
 * placement.
 *
 * Mirrors {@link file://./kit-column.test.tsx} — same shape, location
 * data instead of kit data.
 *
 * @see {@link file://./advanced-asset-columns.tsx}
 */
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AdvancedIndexAsset } from "~/modules/asset/types";

vi.mock("lottie-react", () => ({
  default: () => null,
}));

// why: react-router's Button (which wraps Link under the hood) reads
// route context; the route tree isn't mounted in unit tests, so swap
// the Button for a plain anchor that preserves the `to` prop for
// assertions.
vi.mock("~/components/shared/button", () => ({
  Button: ({
    to,
    children,
    ...rest
  }: {
    to?: string;
    children: ReactNode;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

// why: LocationBadge pulls in icons and hierarchy helpers; stub to a
// minimal span so the test focuses on the column's own rendering
// decisions.
vi.mock("~/components/location/location-badge", () => ({
  LocationBadge: ({ location }: { location: { name: string } }) => (
    <span data-testid="location-badge">{location.name}</span>
  ),
}));

import { LocationColumn } from "./advanced-asset-columns";

function renderCell(locations: AdvancedIndexAsset["locations"]) {
  return render(
    <table>
      <tbody>
        <tr>
          <LocationColumn locations={locations} />
        </tr>
      </tbody>
    </table>
  );
}

function makeLocation(
  id: string,
  name: string,
  parentId: string | null = null,
  childCount: number = 0
): AdvancedIndexAsset["locations"][number] {
  return { id, name, parentId, childCount };
}

describe("LocationColumn", () => {
  it("renders the empty placeholder when locations is an empty array", () => {
    renderCell([]);

    expect(screen.getByLabelText("No data")).toBeInTheDocument();
    expect(screen.queryByTestId("location-more-chip")).not.toBeInTheDocument();
  });

  it("renders a single location badge with no +N chip", () => {
    renderCell([makeLocation("loc-1", "Office")]);

    expect(screen.getByTestId("location-badge")).toHaveTextContent("Office");
    expect(screen.queryByTestId("location-more-chip")).not.toBeInTheDocument();
  });

  it("renders the primary location plus a +N more chip for multiple locations", () => {
    renderCell([
      makeLocation("loc-1", "Office"),
      makeLocation("loc-2", "Warehouse"),
      makeLocation("loc-3", "Field"),
    ]);

    // Primary location gets the visible badge.
    expect(screen.getByTestId("location-badge")).toHaveTextContent("Office");

    // Chip indicates 2 additional locations.
    const chip = screen.getByTestId("location-more-chip");
    expect(chip).toHaveTextContent("+2 more");
  });

  it("lists every location name in the tooltip on hover", async () => {
    const user = userEvent.setup();

    renderCell([
      makeLocation("loc-1", "Office"),
      makeLocation("loc-2", "Warehouse"),
      makeLocation("loc-3", "Field"),
    ]);

    const chip = screen.getByTestId("location-more-chip");
    await user.hover(chip);

    const tooltip = await screen.findByTestId("location-more-tooltip");
    expect(tooltip).toHaveTextContent("Office");
    expect(tooltip).toHaveTextContent("Warehouse");
    expect(tooltip).toHaveTextContent("Field");
  });
});
