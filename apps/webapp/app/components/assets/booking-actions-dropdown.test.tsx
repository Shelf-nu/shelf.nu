/**
 * BookingActionsDropdown — unit tests
 *
 * Pins the kit-membership gate on the asset overview page's "Book" dropdown:
 * an INDIVIDUAL asset inside a kit must be booked through its kit, but a
 * QUANTITY_TRACKED asset only allocates a *slice* of its pool per kit and
 * keeps the remainder directly bookable.
 *
 * Regression: a customer's qty-tracked asset (6 units, 4 allocated to kits,
 * 2 free) had both booking actions disabled here while the booking page's own
 * asset picker happily accepted it.
 *
 * @see {@link file://./booking-actions-dropdown.tsx}
 * @see {@link file://./../../modules/asset/utils.ts}
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookingActionsDropdown from "./booking-actions-dropdown";
import type { BookLink } from "../shared/generic-add-to-bookings-actions-dropdown";

const useLoaderDataMock = vi.hoisted(() => vi.fn());

// why: the component reads the asset straight off the route loader; there is
// no prop seam to inject it through.
vi.mock("react-router", () => ({
  useLoaderData: useLoaderDataMock,
}));

// why: `useCurrentOrganization` reads the _layout route loader via
// `useRouteLoaderData`, which needs a full router context we don't need here.
vi.mock("~/hooks/use-current-organization", () => ({
  useCurrentOrganization: () => ({ id: "org-1", type: "TEAM" }),
}));

const canArchiveMock = vi.hoisted(() => vi.fn(() => true));

// why: the archived reason is worded for the viewer's role, which the hook
// reads from the _layout route loader; the role is the variable under test.
vi.mock("~/hooks/use-can-archive-assets", () => ({
  useCanArchiveAssets: canArchiveMock,
}));

/**
 * Captured `links` from the last render, so assertions can read the
 * `disabled` decision for each booking action.
 *
 * why: the real dropdown renders its items inside a Radix Popover portal that
 * only mounts once hydrated and opened — neither happens in Happy DOM. The
 * links array IS the component's output contract, so we assert on it directly.
 */
let capturedLinks: BookLink[] = [];
/** The `disabledTrigger` from the last render: why the Book button is off. */
let capturedTrigger: unknown;

vi.mock("../shared/generic-add-to-bookings-actions-dropdown", () => ({
  GenericBookActionsDropdown: ({
    links,
    disabledTrigger,
  }: {
    links: BookLink[];
    disabledTrigger: unknown;
  }) => {
    capturedLinks = links;
    capturedTrigger = disabledTrigger;
    return null;
  },
}));

/** Reads the `disabled` prop the component assigned to a named booking action */
function disabledFor(label: string) {
  return capturedLinks.find((link) => link.label === label)?.disabled;
}

const baseAsset = {
  id: "asset-1",
  title: "Canon EF 16-35mm Lens",
  availableToBook: true,
};

const kitMembership = (kitId: string, name: string) => ({
  id: `pivot-${kitId}`,
  quantity: 1,
  kit: { id: kitId, name },
});

describe("BookingActionsDropdown", () => {
  beforeEach(() => {
    capturedLinks = [];
    capturedTrigger = undefined;
    canArchiveMock.mockReturnValue(true);
  });

  it("blocks both booking actions for an INDIVIDUAL asset inside a kit", () => {
    useLoaderDataMock.mockReturnValue({
      asset: {
        ...baseAsset,
        type: "INDIVIDUAL",
        assetKits: [kitMembership("kit-1", "Camera kit")],
      },
    });

    render(<BookingActionsDropdown />);

    expect(disabledFor("Create new booking")).toMatchObject({
      reason: expect.anything(),
    });
    expect(disabledFor("Add to existing booking")).toMatchObject({
      reason: expect.anything(),
    });
  });

  it("keeps both booking actions enabled for a QUANTITY_TRACKED asset spread across kits", () => {
    useLoaderDataMock.mockReturnValue({
      asset: {
        ...baseAsset,
        type: "QUANTITY_TRACKED",
        quantity: 6,
        assetKits: [
          kitMembership("kit-1", "BMPCC4K Kit w/ Tripod - Pa"),
          kitMembership("kit-2", "BMPCC4K Kit w/ Tripod - Hi"),
          kitMembership("kit-3", "BMPCC4K Kit w/ Tripod - Ta"),
          kitMembership("kit-4", "BMPCC4K Kit w/ Tripod - Ti"),
        ],
      },
    });

    render(<BookingActionsDropdown />);

    expect(disabledFor("Create new booking")).toBe(false);
    expect(disabledFor("Add to existing booking")).toBe(false);
  });

  it("keeps booking actions enabled for an asset that belongs to no kit", () => {
    useLoaderDataMock.mockReturnValue({
      asset: { ...baseAsset, type: "INDIVIDUAL", assetKits: [] },
    });

    render(<BookingActionsDropdown />);

    expect(disabledFor("Create new booking")).toBe(false);
    expect(disabledFor("Add to existing booking")).toBe(false);
  });

  it("tells an admin to reinstate an archived asset to book it", () => {
    useLoaderDataMock.mockReturnValue({
      asset: {
        ...baseAsset,
        type: "INDIVIDUAL",
        assetKits: [],
        archivedAt: "2026-10-01T00:00:00Z",
      },
    });

    render(<BookingActionsDropdown />);

    expect(capturedTrigger).toEqual({
      reason: "This asset is archived. Reinstate it to book it.",
    });
  });

  it("tells Base and Self-service to ask an admin, since they cannot reinstate", () => {
    canArchiveMock.mockReturnValue(false);
    useLoaderDataMock.mockReturnValue({
      asset: {
        ...baseAsset,
        type: "INDIVIDUAL",
        assetKits: [],
        archivedAt: "2026-10-01T00:00:00Z",
      },
    });

    render(<BookingActionsDropdown />);

    expect(capturedTrigger).toEqual({
      reason: "This asset is archived. Ask an admin to reinstate it.",
    });
  });
});
