/**
 * Smoke tests for {@link BulkPartialCheckoutDialog} — QT partial top-off fix.
 *
 * These contract-level tests verify the dialog correctly distinguishes
 * "partially out, more to go" from "fully out" for QUANTITY_TRACKED assets:
 *
 * - When the loader supplies `remainingToCheckOutByAsset[assetId] > 0`, the
 *   QT asset stays visible in the dialog even when its id is also listed in
 *   `checkedOutAssetIds` (prior partial checkout). The qty input is bounded
 *   by the remaining-to-check-out value (NOT `bookedQuantity`), so the user
 *   can top off the leftover units without over-committing.
 * - INDIVIDUAL assets keep their binary gate: an id listed in
 *   `checkedOutAssetIds` is filtered out regardless of any QT-specific
 *   remaining map.
 *
 * Server-side semantics (PartialBookingCheckout.create only records positive
 * quantities) are covered by `service.server.partial-checkout.test.ts`.
 *
 * Mocks:
 * - `react-router` — useLoaderData/useActionData/useNavigation are stubbed
 *   so we can drive loader-data per test without a data router.
 * - `~/components/custom-form` — render as a plain `<form>` to avoid
 *   pulling Remix's Form / router context.
 * - `~/components/booking/checkout-dialog` — neutralised (not reached on
 *   the partial-top-off code path; only on the final/early-checkout path).
 * - `~/components/assets/asset-image/component` & `~/components/kits/kit-image`
 *   — image components have their own loader chains we don't exercise here.
 *
 * @see {@link file://./bulk-partial-checkout-dialog.tsx}
 */

import type { ReactNode } from "react";
import { AssetStatus, AssetType, BookingStatus } from "@prisma/client";
import { render, screen } from "@testing-library/react";
import { useActionData, useLoaderData } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import BulkPartialCheckoutDialog from "./bulk-partial-checkout-dialog";

// why: react-router hooks need a router context — stub them so we can drive
// loader/action data per test. The dialog only reads `useLoaderData`,
// `useActionData`, and `useNavigation` (via `useDisabled`).
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: vi.fn(),
    useActionData: vi.fn(() => undefined),
    useNavigation: vi.fn(() => ({ state: "idle" })),
  };
});

// why: the custom Form wraps react-router's Form which requires a data
// router. A plain `<form>` is enough for the dialog rendering assertions.
vi.mock("~/components/custom-form", () => ({
  Form: ({ children, ...props }: { children: ReactNode }) => (
    <form {...props}>{children}</form>
  ),
}));

// why: the early-checkout branch (CheckoutDialog) is not reached on the
// partial-top-off code path; stubbing avoids pulling its react-router
// dependencies. If the test ever lands on the final-checkout path, the
// stub still renders the marker so the assertion fails loudly.
vi.mock("./checkout-dialog", () => ({
  default: () => <div data-testid="checkout-dialog-mock" />,
}));

// why: image components have their own server loader chains (signed URLs,
// expiration refresh) we don't exercise in this dialog test.
vi.mock("../assets/asset-image/component", () => ({
  AssetImage: () => <div data-testid="asset-image" />,
}));

vi.mock("../kits/kit-image", () => ({
  default: () => <div data-testid="kit-image" />,
}));

/**
 * Mutable per-test selection. `selectedBulkItemsAtom` resets to `[]` on
 * mount (see `app/atoms/list.ts`), so seeding a real jotai store gets wiped
 * the moment the dialog subscribes. Mocking `useAtomValue` to return this
 * variable side-steps the reset cleanly.
 */
let mockSelectedBulkItems: unknown[] = [];

// why: jotai's `useAtomValue` reads from a Provider-scoped store. Stubbing
// it bypasses the `selectedBulkItemsAtom.onMount` reset that wipes any
// seeded selection at subscription time.
vi.mock("jotai", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("jotai");
  return {
    ...actual,
    useAtomValue: () => mockSelectedBulkItems,
  };
});

const useLoaderDataMock = vi.mocked(useLoaderData);
const useActionDataMock = vi.mocked(useActionData);

/* ------------------------- fixture helpers ------------------------- */

/**
 * Selection-atom shape for an asset row. Mirrors what the booking overview
 * list seeds into `selectedBulkItemsAtom` — `title` (not `name`) routes the
 * dialog's flatMap through the "direct asset object" branch, and
 * `bookingAssetId` keys the per-slice qty input.
 */
type SelectedAssetRow = {
  id: string;
  title: string;
  status: AssetStatus;
  type: AssetType;
  bookingAssetId: string;
  bookedQuantity: number;
  kitId: string | null;
  thumbnailImage: string | null;
  mainImage: string | null;
  mainImageExpiration: Date | null;
  category: { id: string; name: string } | null;
};

/**
 * Build a minimal loader payload matching what the bulk dialog reads off
 * `useLoaderData` — `booking.bookingAssets`, `checkedOutAssetIds`, and
 * `remainingToCheckOutByAsset`. Other loader fields are omitted; the dialog
 * doesn't touch them on this code path.
 */
function makeLoaderData({
  bookingAssets,
  checkedOutAssetIds,
  remainingToCheckOutByAsset,
}: {
  bookingAssets: Array<{
    id: string;
    /**
     * BookingAsset row quantity. Production always populates this; tests
     * default it to 1 if omitted to match the loader's `ba.quantity ?? 1`
     * projection (otherwise spreading an `undefined` overrides any
     * `bookedQuantity` the caller put on the selection item).
     */
    quantity?: number;
    /**
     * Kit-slice discriminator: `null`/omitted = standalone (free-pool) row;
     * non-null = kit-driven row (matched against `asset.assetKits[].id`). The
     * dialog's `assetsList` projection resolves `kit`/`kitId` from this.
     */
    assetKitId?: string | null;
    asset: {
      id: string;
      title: string;
      status: AssetStatus;
      type: AssetType;
      /**
       * AssetKit memberships surfaced on the asset. A kit-driven slice matches
       * one via `assetKitId` to resolve its `kit`/`kitId`. Omitted for
       * standalone-only assets.
       */
      assetKits?: Array<{
        id: string;
        kitId: string;
        kit: { id: string; name: string };
      }>;
    };
  }>;
  checkedOutAssetIds: string[];
  remainingToCheckOutByAsset: Record<string, number>;
}) {
  return {
    booking: {
      id: "booking-1",
      name: "Test Booking",
      status: BookingStatus.ONGOING,
      from: new Date("2024-01-01T10:00:00Z"),
      to: new Date("2024-01-05T10:00:00Z"),
      bookingAssets,
    },
    checkedOutAssetIds,
    remainingToCheckOutByAsset,
  };
}

/** Seed the mocked `useAtomValue` return for this test. */
function seedSelection(selected: SelectedAssetRow[]) {
  mockSelectedBulkItems = selected;
}

function renderDialog() {
  return render(<BulkPartialCheckoutDialog open setOpen={vi.fn()} />);
}

/* ---------------------------- tests -------------------------------- */

describe("BulkPartialCheckoutDialog — QT partial top-off", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActionDataMock.mockReturnValue(undefined);
  });

  it("keeps a partially-checked-out QT asset visible and bounds the qty input by remainingToCheckOut", () => {
    // Pencils: QT, booked = 50, already partially checked out (its id appears
    // in `checkedOutAssetIds`), and `remainingToCheckOutByAsset` reports 45
    // units left to check out. The dialog must NOT filter it — it's the
    // partial-top-off scenario.
    const pencils: SelectedAssetRow = {
      id: "pencils-id",
      title: "Pencils",
      status: AssetStatus.AVAILABLE,
      type: AssetType.QUANTITY_TRACKED,
      bookingAssetId: "ba-pencils",
      bookedQuantity: 50,
      kitId: null,
      thumbnailImage: null,
      mainImage: null,
      mainImageExpiration: null,
      category: null,
    };

    useLoaderDataMock.mockReturnValue(
      makeLoaderData({
        bookingAssets: [
          {
            id: pencils.bookingAssetId,
            // BookingAsset.quantity must match the booked qty the row
            // declares — production always populates it; without it the
            // loader-side projection defaults to 1 and the qty input's
            // `max` would clamp to 1 instead of remainingToCheckOut.
            quantity: pencils.bookedQuantity,
            asset: {
              id: pencils.id,
              title: pencils.title,
              status: pencils.status,
              type: pencils.type,
            },
          },
        ],
        // why: classic top-off — the QT asset has prior partial-checkout
        // records so its id IS in `checkedOutAssetIds`. The new behaviour
        // (`remainingToCheckOutByAsset > 0` keeps it visible) is what we
        // assert against.
        checkedOutAssetIds: [pencils.id],
        remainingToCheckOutByAsset: { [pencils.id]: 45 },
      })
    );

    seedSelection([pencils]);

    renderDialog();

    // The asset row is rendered (not filtered out by the legacy gate).
    expect(screen.getByText("Pencils")).toBeInTheDocument();

    // Qty input is bounded by remainingToCheckOut (45) — NOT bookedQuantity
    // (50). Over-committing is the exact bug this fix prevents.
    const qtyInput = screen.getByLabelText(
      /checkout quantity/i
    ) as HTMLInputElement;
    expect(qtyInput).toBeInTheDocument();
    expect(Number(qtyInput.max)).toBe(45);

    // Default value mirrors the remaining-to-check-out, so a single click
    // checks out everything still owed without manual edits.
    expect(qtyInput.value).toBe("45");

    // "/ 45" trailing label — operators read this to confirm the cap.
    expect(screen.getByText(/of 45/i)).toBeInTheDocument();

    // Submit is enabled — the partial-top-off path is the whole point of
    // this dialog rendering Pencils despite the prior checkout record.
    // `getByRole("button", ...)` would also match the dialog-backdrop's
    // role="button" wrapper (its accessible name includes nested text),
    // so query the named form-submit button directly.
    const submit = document.querySelector<HTMLButtonElement>(
      'button[type="submit"][name="intent"][value="partial-checkout"]'
    );
    expect(submit).not.toBeNull();
    expect(submit).not.toBeDisabled();
  });

  it("renders a selected STANDALONE slice of a multi-slice QT asset (list not empty)", () => {
    // Batteries: QT asset booked BOTH standalone (10 units, kitId null) and
    // inside a kit (20 units, kitId kit-1) — two BookingAsset slices sharing
    // one asset.id. The user selected ONLY the standalone slice. Before the
    // fix, `assetsList` deduped by asset.id (kit slice won) and the flatten
    // clobbered the standalone slice's kitId → the row rendered in NEITHER
    // bucket (empty list). Now both slices survive and the standalone slice
    // enriches correctly, so its row + qty input render.
    const standaloneSlice: SelectedAssetRow = {
      id: "battery-id",
      title: "Batteries",
      status: AssetStatus.AVAILABLE,
      type: AssetType.QUANTITY_TRACKED,
      bookingAssetId: "ba-standalone",
      bookedQuantity: 10,
      kitId: null,
      thumbnailImage: null,
      mainImage: null,
      mainImageExpiration: null,
      category: null,
    };

    useLoaderDataMock.mockReturnValue(
      makeLoaderData({
        bookingAssets: [
          // Standalone slice — no assetKitId → kitId resolves to null.
          {
            id: "ba-standalone",
            quantity: 10,
            assetKitId: null,
            asset: {
              id: "battery-id",
              title: "Batteries",
              status: AssetStatus.AVAILABLE,
              type: AssetType.QUANTITY_TRACKED,
            },
          },
          // Kit-driven slice for the SAME asset id — must NOT collapse the
          // standalone slice out of `assetsList`.
          {
            id: "ba-kit",
            quantity: 20,
            assetKitId: "ak-1",
            asset: {
              id: "battery-id",
              title: "Batteries",
              status: AssetStatus.AVAILABLE,
              type: AssetType.QUANTITY_TRACKED,
              assetKits: [
                {
                  id: "ak-1",
                  kitId: "kit-1",
                  kit: { id: "kit-1", name: "Kit" },
                },
              ],
            },
          },
        ],
        checkedOutAssetIds: [],
        // Asset-level remaining across both slices (10 + 20).
        remainingToCheckOutByAsset: { "battery-id": 30 },
      })
    );

    seedSelection([standaloneSlice]);

    renderDialog();

    // The standalone slice renders — the list is NOT empty.
    expect(screen.getByText("Batteries")).toBeInTheDocument();

    // Its qty input is present, bounded by the standalone slice's booked units.
    const qtyInput = screen.getByLabelText(
      /checkout quantity/i
    ) as HTMLInputElement;
    expect(qtyInput).toBeInTheDocument();
    expect(Number(qtyInput.max)).toBe(10);
    expect(qtyInput.value).toBe("10");

    // Submit is enabled — there is a slice to check out.
    const submit = document.querySelector<HTMLButtonElement>(
      'button[type="submit"][name="intent"][value="partial-checkout"]'
    );
    expect(submit).not.toBeNull();
    expect(submit).not.toBeDisabled();
  });

  it("still filters INDIVIDUAL assets whose id appears in checkedOutAssetIds (unchanged)", () => {
    // Camera: INDIVIDUAL, already checked out (id in `checkedOutAssetIds`).
    // Even with a `remainingToCheckOutByAsset` map populated for unrelated
    // assets, INDIVIDUAL keeps its binary gate — second checkout attempt
    // is rejected, mirroring the singular check-out flow.
    const camera: SelectedAssetRow = {
      id: "camera-id",
      title: "Camera",
      status: AssetStatus.AVAILABLE,
      type: AssetType.INDIVIDUAL,
      bookingAssetId: "ba-camera",
      bookedQuantity: 1,
      kitId: null,
      thumbnailImage: null,
      mainImage: null,
      mainImageExpiration: null,
      category: null,
    };

    useLoaderDataMock.mockReturnValue(
      makeLoaderData({
        bookingAssets: [
          {
            id: camera.bookingAssetId,
            asset: {
              id: camera.id,
              title: camera.title,
              status: camera.status,
              type: camera.type,
            },
          },
        ],
        checkedOutAssetIds: [camera.id],
        // why: confirms the QT-only map does NOT relax the INDIVIDUAL gate.
        // A stray entry for `camera-id` must NOT make it eligible — the gate
        // is by asset type, not by map presence.
        remainingToCheckOutByAsset: { [camera.id]: 1 },
      })
    );

    seedSelection([camera]);

    renderDialog();

    // INDIVIDUAL row is filtered out — title nowhere in the DOM.
    expect(screen.queryByText("Camera")).not.toBeInTheDocument();

    // No QT-style qty input either — there's nothing to check out.
    expect(
      screen.queryByLabelText(/checkout quantity/i)
    ).not.toBeInTheDocument();

    // Submit is disabled because the eligible selection is empty.
    const submit = document.querySelector<HTMLButtonElement>(
      'button[type="submit"][name="intent"][value="partial-checkout"]'
    );
    expect(submit).not.toBeNull();
    expect(submit).toBeDisabled();
  });
});
