/**
 * Tests for the "Check in selected items" dialog's form.
 *
 * The booking overview records how a check-in was made from what the posting
 * form declares, so this dialog must say `method=selected` itself, on both of
 * its submit paths: the partial check-in button, and the early check-in dialog
 * that closes the booking when the selection is the last of it.
 *
 * @see {@link file://./bulk-partial-checkin-dialog.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx} - the `checkIn` branch that reads it
 */
import type { ReactNode } from "react";
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import { render } from "@testing-library/react";
import { useActionData, useLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BulkPartialCheckinDialog from "./bulk-partial-checkin-dialog";

// why: react-router hooks need a router context; stub them so each test drives
// the loader data. The dialog reads `useLoaderData`, `useActionData` and
// `useNavigation` (through `useDisabled`).
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useActionData: vi.fn(() => undefined),
    useNavigation: vi.fn(() => ({ state: "idle" })),
  };
});

// why: the custom Form wraps react-router's Form, which needs a data router. A
// plain `<form>` keeps the id and the hidden inputs this test reads.
vi.mock("~/components/custom-form", () => ({
  Form: ({ children, ...props }: { children: ReactNode }) => (
    <form {...props}>{children}</form>
  ),
}));

// why: the early check-in branch renders CheckinDialog, whose react-router
// dependencies this harness does not mount. The stub marks that the branch was
// taken and which rows it would post.
vi.mock("./checkin-dialog", () => ({
  default: ({ specificAssetIds }: { specificAssetIds?: string[] }) => (
    <div
      data-testid="checkin-dialog-mock"
      data-specific={JSON.stringify(specificAssetIds ?? [])}
    />
  ),
}));

// why: image components carry signed-URL loader chains this dialog test does
// not exercise.
vi.mock("../assets/asset-image/component", () => ({
  AssetImage: () => <div data-testid="asset-image" />,
}));
vi.mock("../kits/kit-image", () => ({
  default: () => <div data-testid="kit-image" />,
}));

/**
 * Mutable per-test selection. `selectedBulkItemsAtom` resets to `[]` on
 * mount, so a seeded jotai store is wiped the moment the dialog subscribes;
 * returning this variable from `useAtomValue` side-steps the reset.
 */
let mockSelectedBulkItems: unknown[] = [];

// why: see `mockSelectedBulkItems`; the atom's `onMount` reset would otherwise
// empty the selection before the dialog renders it.
vi.mock("jotai", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("jotai");
  return {
    ...actual,
    useAtomValue: () => mockSelectedBulkItems,
  };
});

const useLoaderDataMock = vi.mocked(useLoaderData);
const useActionDataMock = vi.mocked(useActionData);

/** A checked-out INDIVIDUAL asset as the overview list seeds the selection. */
function checkedOutRow(id: string, title: string) {
  return {
    id,
    title,
    status: AssetStatus.CHECKED_OUT,
    type: AssetType.INDIVIDUAL,
    bookingAssetId: `ba-${id}`,
    bookedQuantity: 1,
    kitId: null,
    thumbnailImage: null,
    mainImage: null,
    mainImageExpiration: null,
    category: null,
  };
}

const camera = checkedOutRow("asset-camera", "Camera");
const tripod = checkedOutRow("asset-tripod", "Tripod");

/**
 * Loader payload for an ONGOING booking that ends well in the future, so a
 * final check-in counts as early and takes the confirming dialog.
 */
function loaderData(rows: Array<typeof camera>) {
  return {
    booking: {
      id: "booking-1",
      name: "Shoot",
      status: BookingStatus.ONGOING,
      from: new Date("2026-01-01T10:00:00Z"),
      to: new Date("2099-01-05T10:00:00Z"),
      bookingAssets: rows.map((row) => ({
        id: row.bookingAssetId,
        quantity: row.bookedQuantity,
        assetKitId: null,
        asset: {
          id: row.id,
          title: row.title,
          status: row.status,
          type: row.type,
          assetKits: [],
        },
      })),
    },
    partialCheckinProgress: { checkedInAssetIds: [] },
    partialCheckinDetails: {},
  };
}

/** The dialog's form and the `method` it declares. */
function declaredMethod() {
  const form = document.querySelector<HTMLFormElement>(
    "form#bulk-partial-checkin-form"
  );
  expect(form).not.toBeNull();
  return form!.querySelector<HTMLInputElement>('input[name="method"]')?.value;
}

describe("BulkPartialCheckinDialog form", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActionDataMock.mockReturnValue(undefined);
    useLoaderDataMock.mockReturnValue(loaderData([camera, tripod]));
  });

  it("declares method=selected next to the rows of a partial check-in", () => {
    // One of two checked-out items: a partial check-in, posted by the button.
    mockSelectedBulkItems = [camera];

    render(<BulkPartialCheckinDialog open setOpen={vi.fn()} />);

    expect(declaredMethod()).toBe("selected");
    expect(
      document.querySelector<HTMLInputElement>('input[name="assetIds[0]"]')
        ?.value
    ).toBe(camera.id);
    expect(
      document.querySelector(
        'button[type="submit"][name="intent"][value="partial-checkin"]'
      )
    ).not.toBeNull();
  });

  it("declares method=selected on the early check-in that closes the booking too", () => {
    // Both remaining items: the final check-in, early, so the confirming
    // dialog posts `intent=checkIn` through this same form.
    mockSelectedBulkItems = [camera, tripod];

    const { getByTestId } = render(
      <BulkPartialCheckinDialog open setOpen={vi.fn()} />
    );

    expect(getByTestId("checkin-dialog-mock").dataset.specific).toBe(
      JSON.stringify([camera.id, tripod.id])
    );
    expect(declaredMethod()).toBe("selected");
  });
});
