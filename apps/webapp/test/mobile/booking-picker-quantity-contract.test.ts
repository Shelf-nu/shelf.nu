/**
 * Wire-contract test: booking picker quantity fields (webapp ↔ companion).
 *
 * The mobile booking-asset picker endpoint
 * (`app/routes/api+/mobile+/bookings.available-assets.ts`, wire shape
 * `MobileAvailableAssetRow`) and the companion's `AvailableAsset` type
 * (`apps/companion/lib/api/types.ts`) are hand-maintained twins — Zod/type
 * mismatches between them show up in NEITHER side's own unit tests, so this
 * roundtrip asserts the contract at the seam:
 *
 *  1. COMPILE TIME — the JSON-serialized server row must be assignable to the
 *     companion type. Adding a required field on one side without the other
 *     breaks `pnpm --filter @shelf/webapp typecheck`, not production.
 *  2. RUNTIME — representative rows survive JSON serialization with the
 *     quantity semantics intact (workspace stock vs clamped windowed
 *     headroom, and the INDIVIDUAL null-out).
 *
 * Type-only import of the route module keeps this test free of server
 * dependencies (db, Supabase) — nothing is executed, so no mocks are needed.
 * Consequence: anything that depends on the loader RUNNING is out of scope
 * here. The "never negative headroom" clamp the picker relies on is a property
 * of the canonical pool module and is property-tested there
 * (`app/modules/asset/availability.test.ts`) — asserting it against a literal
 * fixture in this file could not fail, so it is deliberately not repeated.
 *
 * @see {@link file://../../app/routes/api+/mobile+/bookings.available-assets.ts}
 * @see {@link file://../../../companion/lib/api/types.ts}
 * @see {@link file://../../../companion/lib/quantity-format.ts} row-consumer helpers
 */
import type { AvailableAsset } from "../../../companion/lib/api/types";
import type { MobileAvailableAssetRow } from "../../app/routes/api+/mobile+/bookings.available-assets";

// @vitest-environment node

/**
 * What a server value looks like after `JSON.stringify` → `JSON.parse` on the
 * wire: `Date` becomes an ISO string, everything this payload carries
 * (strings / numbers / nulls / plain objects) is preserved as-is.
 */
type Serialized<T> = {
  [K in keyof T]: Date extends Extract<T[K], Date>
    ? Exclude<T[K], Date> | string
    : T[K];
};

/**
 * Compile-time assignability gate. Instantiating it with a `From` that does
 * not satisfy `To` is a type error, which fails the webapp typecheck.
 */
type AssertAssignable<To, From extends To> = [To, From];

/**
 * THE contract: every field the server emits must be acceptable to the
 * companion, and every field the companion requires must be emitted. New
 * fields land server-side first and MUST be optional on the companion type
 * (live app versions tolerate older servers) — that direction is exactly what
 * this assignability encodes.
 */
type _ServerRowSatisfiesCompanionContract = AssertAssignable<
  AvailableAsset,
  Serialized<MobileAvailableAssetRow>
>;

/** Simulates the wire: what the companion's `apiFetch` JSON-parses. */
function roundtrip(row: MobileAvailableAssetRow): AvailableAsset {
  return JSON.parse(JSON.stringify(row)) as AvailableAsset;
}

/** A fully-populated QUANTITY_TRACKED picker row as the loader builds it. */
const quantityTrackedRow: MobileAvailableAssetRow = {
  id: "asset-qt-1",
  title: "Tablecloth",
  status: "AVAILABLE",
  mainImage: null,
  mainImageExpiration: new Date("2026-07-28T10:00:00.000Z"),
  thumbnailImage: null,
  kitId: null,
  displayCode: { value: "w7l4c42u01", label: "QR Code ID" },
  // Workspace stock (Asset.quantity) — the "of N" denominator.
  quantity: 10,
  unitOfMeasure: "pcs",
  // Clamped windowed headroom from the canonical booking-pool module.
  availableQuantity: 3,
};

/** An INDIVIDUAL row — quantity family nulled out, availability via filter. */
const individualRow: MobileAvailableAssetRow = {
  id: "asset-ind-1",
  title: "Camera",
  status: "AVAILABLE",
  mainImage: null,
  mainImageExpiration: null,
  thumbnailImage: null,
  kitId: null,
  displayCode: null,
  quantity: null,
  unitOfMeasure: null,
  availableQuantity: null,
};

describe("booking picker quantity wire contract", () => {
  it("delivers workspace stock + clamped headroom for a QUANTITY_TRACKED row", () => {
    const received = roundtrip(quantityTrackedRow);

    // The two quantity semantics stay distinct across the wire: `quantity`
    // is workspace stock, `availableQuantity` is the windowed headroom —
    // conflating them is the exact lie this feature removes.
    expect(received.quantity).toBe(10);
    expect(received.availableQuantity).toBe(3);
    expect(received.unitOfMeasure).toBe("pcs");
    // Date field serializes to an ISO string, which is what the companion
    // type declares — the compile-time assertion above depends on this.
    expect(received.mainImageExpiration).toBe("2026-07-28T10:00:00.000Z");
  });

  it("keeps the zero-headroom state (fully allocated pool) explicit, not absent", () => {
    const received = roundtrip({ ...quantityTrackedRow, availableQuantity: 0 });

    // 0 must survive as 0 — the companion renders it error-tinted as
    // "0 of 10 pcs available". If it were dropped/nulled, the row would
    // silently look like a pre-quantity server and hide the truth.
    expect(received.availableQuantity).toBe(0);
  });

  it("nulls the whole quantity family for INDIVIDUAL rows so the companion renders them unchanged", () => {
    const received = roundtrip(individualRow);

    // The companion's formatQuantity/meta line render nothing on null —
    // INDIVIDUAL rows must not grow a bogus "0 available" line.
    expect(received.quantity).toBeNull();
    expect(received.unitOfMeasure).toBeNull();
    expect(received.availableQuantity).toBeNull();
  });
});
