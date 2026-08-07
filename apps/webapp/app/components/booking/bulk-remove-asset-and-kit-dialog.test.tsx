/**
 * Bulk Remove Asset/Kit Dialog — submitted payload contract.
 *
 * The booking-overview bulk-remove action needs to know which rows the user
 * actually ticked. The shared `BulkUpdateDialogContent` only submits each
 * selected item's `id`, and ticking a kit injects its member rows into the
 * selection — so a kit member's asset id reaches the server whether the user
 * ticked its own row or not. `standaloneAssetIds` carries that lost
 * provenance, and it is what decides whether an asset booked BOTH standalone
 * and inside a kit gets fully removed.
 *
 * These tests render the real dialog, build a `FormData` from the DOM form it
 * produces, and parse it with the real schema — the same round-trip the
 * browser performs. Nothing about the payload is reconstructed by the test,
 * so a renamed hidden input, a dropped input, or a broken selected-row filter
 * fails here.
 *
 * @see {@link file://./bulk-remove-asset-and-kit-dialog.tsx}
 * @see {@link file://./../../routes/_layout+/bookings.$bookingId.overview.tsx}
 */
import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import type * as Jotai from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { bulkDialogAtom } from "~/atoms/bulk-update-dialog";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
} from "~/atoms/list";
import { parseData } from "~/utils/http.server";
import BulkRemoveAssetAndKitDialog, {
  BulkRemoveAssetsAndKitSchema,
} from "./bulk-remove-asset-and-kit-dialog";

/**
 * Per-atom overrides consulted by the mocked `useAtomValue`. Seeding a real
 * store doesn't work: `selectedBulkItemsAtom.onMount` resets it to `[]` the
 * moment the dialog subscribes (see `app/atoms/list.ts`).
 */
const atomValues = new Map<unknown, unknown>();

// why: jotai reads from a Provider-scoped store, and the selection atom wipes
// itself on mount. Overriding per-atom lets us drive the selection while any
// atom we don't stub still resolves normally.
vi.mock("jotai", async () => {
  const actual = await vi.importActual<typeof Jotai>("jotai");
  return {
    ...actual,
    useAtomValue: (anAtom: unknown) =>
      atomValues.has(anAtom)
        ? atomValues.get(anAtom)
        : actual.useAtomValue(
            anAtom as Parameters<typeof actual.useAtomValue>[0]
          ),
    useSetAtom: () => () => {},
  };
});

// why: the dialog reads the booking id off the route loader; no data router
// exists in a component test.
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return {
    ...actual,
    useLoaderData: () => ({ booking: { id: "booking-1" } }),
  };
});

// why: `useFetcherWithReset` needs a data router. A plain `<form>` keeps the
// real hidden inputs in the DOM, which is what these tests read.
vi.mock("~/hooks/use-fetcher-with-reset", () => ({
  default: () => ({
    Form: ({ children, ...props }: { children: ReactNode }) => (
      <form {...props}>{children}</form>
    ),
    state: "idle",
    data: undefined,
    reset: () => {},
  }),
}));

// why: search params come from the router; the dialog only stringifies them
// into a hidden field.
vi.mock("~/hooks/search-params", () => ({
  useSearchParams: () => [new URLSearchParams(), () => {}],
}));

// why: the dialog chrome (portal + modal) adds no payload; rendering children
// inline keeps the form reachable without a portal root.
vi.mock("~/components/layout/dialog", () => ({
  DialogPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

/* ------------------------------ fixtures ------------------------------ */

/**
 * A standalone booking row: the asset was added to the booking on its own,
 * outside any kit. `kitId` null is what marks it standalone.
 */
function standaloneRow(id: string, bookingAssetId: string) {
  return { id, title: `Asset ${id}`, bookingAssetId, kitId: null };
}

/**
 * A kit-driven booking row: this slice exists because the asset is a member
 * of `kitId`. Ticking the kit puts these into the selection automatically.
 */
function kitDrivenRow(id: string, bookingAssetId: string, kitId: string) {
  return { id, title: `Asset ${id}`, bookingAssetId, kitId };
}

/** A kit row. Kits have no pivot row of their own, hence no bookingAssetId. */
function kitRow(id: string) {
  return { id, name: `Kit ${id}`, _count: { assets: 2 } };
}

/**
 * Renders the dialog with `selection` ticked and returns the payload parsed
 * off the real form element, exactly as the action receives it.
 */
function submitPayloadFor(selection: unknown[]) {
  atomValues.set(selectedBulkItemsAtom, selection);
  atomValues.set(selectedBulkItemsCountAtom, selection.length);
  // The shared dialog renders nothing unless its type is the open one.
  atomValues.set(bulkDialogAtom, { trash: true });

  const { container } = render(<BulkRemoveAssetAndKitDialog />);
  const form = container.querySelector("form");
  if (!form) {
    throw new Error("Dialog rendered no form — nothing to submit.");
  }

  return parseData(new FormData(form), BulkRemoveAssetsAndKitSchema);
}

describe("BulkRemoveAssetAndKitDialog payload", () => {
  beforeEach(() => {
    atomValues.clear();
  });

  it("marks only directly-ticked standalone rows as standalone", () => {
    const payload = submitPayloadFor([
      standaloneRow("asset-loose", "ba-1"),
      kitRow("kit-1"),
      kitDrivenRow("asset-member", "ba-2", "kit-1"),
    ]);

    // Every ticked row still goes up in the flat id list…
    expect(payload.assetOrKitIds).toEqual([
      "asset-loose",
      "kit-1",
      "asset-member",
    ]);
    // …but only the loose asset is claimed as a standalone removal. The kit
    // member rode in on the kit and the kit itself has no standalone row.
    expect(payload.standaloneAssetIds).toEqual(["asset-loose"]);
  });

  it("keeps an asset that was ticked standalone AND sits in a ticked kit", () => {
    // The case that motivated the field: one asset, two booking rows. The
    // server can't infer this from kit membership — both rows must be named.
    const payload = submitPayloadFor([
      standaloneRow("asset-both", "ba-standalone"),
      kitDrivenRow("asset-both", "ba-kit", "kit-1"),
      kitRow("kit-1"),
    ]);

    expect(payload.standaloneAssetIds).toEqual(["asset-both"]);
    // Both rows of the shared asset survive into the flat list. They collide
    // on `id`, so the shared dialog keys its inputs by the per-slice
    // selection key — keying by `id` made React warn and risk dropping or
    // mispairing an input when the selection changes with the dialog open.
    expect(payload.assetOrKitIds).toEqual([
      "asset-both",
      "asset-both",
      "kit-1",
    ]);
  });

  it("claims nothing as standalone when only a kit is ticked", () => {
    const payload = submitPayloadFor([
      kitRow("kit-1"),
      kitDrivenRow("asset-member", "ba-2", "kit-1"),
    ]);

    // An empty array, not a missing key — the handler branches on length.
    expect(payload.standaloneAssetIds).toEqual([]);
  });

  it("names every standalone row when no kit is involved", () => {
    const payload = submitPayloadFor([
      standaloneRow("asset-1", "ba-1"),
      standaloneRow("asset-2", "ba-2"),
    ]);

    expect(payload.standaloneAssetIds).toEqual(["asset-1", "asset-2"]);
  });
});
