/**
 * Booking check-in / check-out method
 *
 * How a booking's items were checked out or checked in, and from where. Every
 * `BOOKING_CHECKED_OUT`, `BOOKING_CHECKED_IN`, `BOOKING_PARTIAL_CHECKOUT` and
 * `BOOKING_PARTIAL_CHECKIN` event carries it in `meta`:
 *
 * - `method`: `"quick"` for the one-click whole-booking action, `"scanned"`
 *   for an item that went through a scanner, `"selected"` for an item ticked
 *   in a list, or `null` when the client did not say. The server never guesses
 *   a method: the phone's partial routes cannot tell a scan from a tick, so an
 *   app bundle that sends nothing is recorded as `null`. An event that covers
 *   several slices of one asset handled in different ways is `null` too.
 * - `surface`: `"web"` or `"phone"`, set by the route that received the
 *   request.
 *
 * Pure: no database and no React, so the routes, the service, the activity
 * notes and the printed receipt all read the same words from here.
 *
 * @see {@link file://./service.server.ts} - the four event writers
 * @see {@link file://./../../routes/api+/mobile+/bookings.partial-checkout.ts} - a client-declared method
 */
/** Every method a check-in or check-out row can record. */
export const BOOKING_METHODS = ["quick", "scanned", "selected"] as const;

/** How one item was checked out or in. */
export type BookingMethod = (typeof BOOKING_METHODS)[number];

/**
 * The methods a client may declare in a request body. `"quick"` is not among
 * them: the server knows which routes are the one-click actions and asserts it
 * itself, so a client cannot label a scan as quick or the other way round.
 */
export const CLIENT_DECLARED_BOOKING_METHODS = ["scanned", "selected"] as const;

/** A method a client may declare. */
export type ClientDeclaredBookingMethod =
  (typeof CLIENT_DECLARED_BOOKING_METHODS)[number];

/** Where the request came from. */
export type BookingSurface = "web" | "phone";

/**
 * What a route knows about how a check-in or check-out batch was made.
 *
 * `method` applies to every row of the batch unless `selectedBookingAssetIds`
 * names the row's slice: the web scan pages let an operator tick a
 * quantity-tracked row "without scanning" in the same batch as real scans, and
 * those slices are recorded as `"selected"` while the rest keep the batch's
 * `"scanned"`.
 *
 * Ticked rows are keyed by slice (`BookingAsset.id`), not by asset: a
 * quantity-tracked asset can sit on a standalone slice and a kit slice of the
 * same booking, and the operator may scan one and tick the other.
 */
export type BookingMethodProvenance = {
  surface: BookingSurface;
  /** The batch's method, or `null` when the client did not say. */
  method: BookingMethod | null;
  /** Slices of this batch that were ticked rather than scanned. */
  selectedBookingAssetIds?: readonly string[];
};

/**
 * A slice id as a batch row carries it: `BookingAsset.id`, or nothing for a
 * row posted without one (an INDIVIDUAL asset, or an asset-id-only payload),
 * which can never have been ticked.
 */
export type BatchSliceId = string | null | undefined;

/** What an event's `meta` carries about the method. */
export type BookingMethodMeta = {
  method: BookingMethod | null;
  surface: BookingSurface;
};

/**
 * Resolves the method one slice of a batch is recorded with.
 *
 * @param provenance - What the route said about the batch
 * @param bookingAssetId - The row's slice, if the row named one
 * @returns `"selected"` for a ticked slice, else the batch's method
 */
export function resolveBookingMethod(
  provenance: BookingMethodProvenance,
  bookingAssetId?: BatchSliceId
): BookingMethod | null {
  if (
    bookingAssetId &&
    provenance.selectedBookingAssetIds?.includes(bookingAssetId)
  ) {
    return "selected";
  }
  return provenance.method;
}

/**
 * Resolves the method for an event that covers several slices of one asset.
 *
 * The partial check-in writes one event per asset, however many of its slices
 * the batch touched. One method when every slice agrees; `null` when they do
 * not, so a mixed asset-level event is recorded as "not said" rather than as
 * whichever slice came first.
 *
 * @param provenance - What the route said about the batch
 * @param bookingAssetIds - The slices the event covers; empty for a batch that
 *   names no slices, which reads as the batch's method
 * @returns The one method every slice shares, or `null`
 */
export function resolveBookingMethodForSlices(
  provenance: BookingMethodProvenance,
  bookingAssetIds: readonly BatchSliceId[]
): BookingMethod | null {
  const methods = new Set(
    bookingAssetIds.map((bookingAssetId) =>
      resolveBookingMethod(provenance, bookingAssetId)
    )
  );
  if (methods.size === 0) return provenance.method;
  if (methods.size === 1) return [...methods][0];
  return null;
}

/**
 * Keeps only the ticked slices that are part of the batch.
 *
 * The scan drawers post `selectedBookingAssetIds[]` next to the rows they
 * submit; an id outside the batch would sit in the provenance unused, so it is
 * dropped here and the provenance names exactly the batch slices that were
 * ticked.
 *
 * @param selectedBookingAssetIds - The ticked slices, as the form posted them
 * @param batchBookingAssetIds - The slice of every row the batch submits
 * @returns The ticked slices that the batch contains, deduplicated
 */
export function narrowSelectedBookingAssetIds(
  selectedBookingAssetIds: readonly string[] | undefined,
  batchBookingAssetIds: readonly BatchSliceId[]
): string[] {
  if (!selectedBookingAssetIds || selectedBookingAssetIds.length === 0) {
    return [];
  }
  const inBatch = new Set(batchBookingAssetIds.filter(Boolean));
  return [...new Set(selectedBookingAssetIds.filter((id) => inBatch.has(id)))];
}

/** What a scan named, as the fulfil scanner submits it and the scan helper reports it. */
export type ScannedNames = {
  /** Assets scanned directly; each lands on its standalone slice. */
  assetIds: readonly string[];
  /** Kit memberships the scan added, one per `AssetKit` row. */
  kitSlices: readonly { assetId: string; assetKitId: string }[];
  /** Kits whose label was scanned. */
  kitIds: readonly string[];
  /** Assets that gained a row on this scan. */
  addedAssetIds: readonly string[];
  /** Assets whose standalone row was already on the booking and answered a reservation. */
  claimedAssetIds: readonly string[];
};

/** A booking slice, as far as telling whether a scan named it needs. */
export type ScannedRow = {
  asset: { id: string; type: "INDIVIDUAL" | "QUANTITY_TRACKED" };
  /** The kit membership a kit-driven slice belongs to; `null` for a standalone slice. */
  assetKitId: string | null;
  /** The kit a kit-driven slice came from. */
  sourceKitId: string | null;
};

/**
 * Builds the test for "did this scan go through this booking row".
 *
 * An INDIVIDUAL asset is one unit with one row per booking, so naming the
 * asset in any way names its row, and so does scanning the kit that row came
 * from (a kit already on the booking adds no slice, so only its kit id names
 * its members). A quantity-tracked asset can hold a standalone slice and kit
 * slices on the same booking at once, so its rows are matched by slice: the
 * standalone slice by a direct scan (or a claim of that row), a kit slice by
 * its exact `AssetKit` membership or by its kit's label. Matching a quantity
 * row by asset id would mark a sibling slice the scan never touched as
 * scanned.
 *
 * @param names - What the scan submitted and what the scan helper reported
 * @returns A predicate over the booking's rows after the scan
 */
export function scannedRowPredicate(
  names: ScannedNames
): (row: ScannedRow) => boolean {
  const anyNamedAssetIds = new Set([
    ...names.assetIds,
    ...names.kitSlices.map((slice) => slice.assetId),
    ...names.addedAssetIds,
    ...names.claimedAssetIds,
  ]);
  const directlyScannedAssetIds = new Set([
    ...names.assetIds,
    ...names.claimedAssetIds,
  ]);
  const scannedAssetKitIds = new Set(
    names.kitSlices.map((slice) => slice.assetKitId).filter(Boolean)
  );
  const scannedKitIds = new Set(names.kitIds);

  /** Whether the row is a slice of a kit the scan named. */
  const fromScannedKit = (row: ScannedRow) =>
    (row.assetKitId !== null && scannedAssetKitIds.has(row.assetKitId)) ||
    (row.sourceKitId !== null && scannedKitIds.has(row.sourceKitId));

  return (row) => {
    if (row.asset.type !== "QUANTITY_TRACKED") {
      return anyNamedAssetIds.has(row.asset.id) || fromScannedKit(row);
    }
    if (row.assetKitId === null) {
      return directlyScannedAssetIds.has(row.asset.id);
    }
    return fromScannedKit(row);
  };
}

/**
 * The `meta` keys an event carries for its method.
 *
 * Spread into the event's `meta` next to the quantity keys. Returns `{}` when
 * the caller has no provenance, so the event is written as before rather than
 * with a guessed surface.
 *
 * @param provenance - What the route said about the batch, if anything
 * @param bookingAssetIds - The slices the event covers; the one-click actions
 *   pass none and read as the batch's method
 * @returns `{ method, surface }`, or `{}` without provenance
 */
export function bookingMethodMeta(
  provenance: BookingMethodProvenance | undefined,
  bookingAssetIds: readonly BatchSliceId[] = []
): BookingMethodMeta | Record<string, never> {
  if (!provenance) return {};
  return {
    method: resolveBookingMethodForSlices(provenance, bookingAssetIds),
    surface: provenance.surface,
  };
}

/**
 * Reads the method back off a stored event's `meta`.
 *
 * Strict on purpose: a `meta` written before the method existed, or one
 * carrying a value this code does not know, reads as `null`, so a surface
 * showing the method shows nothing rather than a guess.
 *
 * @param meta - The event's `meta` column, as Prisma returns it
 * @returns The recorded method and surface, or `null` when the event has none
 */
export function readBookingMethodMeta(meta: unknown): BookingMethodMeta | null {
  if (typeof meta !== "object" || meta === null) return null;
  const { method, surface } = meta as Record<string, unknown>;
  if (surface !== "web" && surface !== "phone") return null;
  const knownMethod = (BOOKING_METHODS as readonly string[]).includes(
    method as string
  )
    ? (method as BookingMethod)
    : null;
  return { method: knownMethod, surface };
}

/** The surface as it reads inside a sentence. */
const SURFACE_WORDS: Record<BookingSurface, string> = {
  web: "on the web",
  phone: "on the phone",
};

/**
 * Says how a row was handled, as the tail of a sentence.
 *
 * - `"scanned on the phone"`, `"selected on the web"`
 * - `"in one click on the web"`, `"in one tap on the phone"`
 * - `"on the phone"` when the client did not say how
 *
 * @param meta - The recorded method and surface
 * @returns The phrase, without a leading comma or a full stop
 */
export function describeBookingMethod(meta: BookingMethodMeta): string {
  const where = SURFACE_WORDS[meta.surface];
  switch (meta.method) {
    case "quick":
      return meta.surface === "phone"
        ? `in one tap ${where}`
        : `in one click ${where}`;
    case "scanned":
      return `scanned ${where}`;
    case "selected":
      return `selected ${where}`;
    default:
      return where;
  }
}

/**
 * Says how a whole batch was handled, for the booking's activity line.
 *
 * A batch whose slices share one method reads like one row. A web scan batch
 * that mixed real scans with ticked rows reads `"scanned and selected on the
 * web"`, naming both rather than picking one.
 *
 * @param provenance - What the route said about the batch
 * @param bookingAssetIds - The slice of every row the batch touched
 * @returns The phrase, without a leading comma or a full stop
 */
export function describeBatchMethod(
  provenance: BookingMethodProvenance,
  bookingAssetIds: readonly BatchSliceId[]
): string {
  const methods = new Set(
    bookingAssetIds.map((bookingAssetId) =>
      resolveBookingMethod(provenance, bookingAssetId)
    )
  );
  if (methods.size === 2 && methods.has("scanned") && methods.has("selected")) {
    return `scanned and selected ${SURFACE_WORDS[provenance.surface]}`;
  }
  const [method] = methods.size === 1 ? [...methods] : [provenance.method];
  return describeBookingMethod({ method, surface: provenance.surface });
}

/**
 * The clause a system note appends to say how a batch was handled, as a
 * parenthetical with its leading space: `" (scanned on the phone)"`. A
 * parenthetical rather than a comma, because the clause follows an entity link
 * whose rendering keeps an inline icon slot after the name: a comma would print
 * with a space in front of it, a bracket reads as intended. Empty when the
 * caller has no provenance, so a note written without one reads exactly as
 * before.
 *
 * @param provenance - What the route said about the batch, if anything
 * @param bookingAssetIds - The slice of every row the batch touched; without
 *   them the batch's own method is used, which is right for the one-click
 *   actions
 * @returns `" (<phrase>)"` or `""`
 */
export function bookingMethodClause(
  provenance: BookingMethodProvenance | undefined,
  bookingAssetIds: readonly BatchSliceId[] = []
): string {
  if (!provenance) return "";
  return ` (${describeBatchMethod(provenance, bookingAssetIds)})`;
}

/**
 * Capitalises a method phrase for a place that starts a sentence or a cell,
 * such as the receipt: `"Scanned on the phone"`.
 *
 * @param meta - The recorded method and surface
 * @returns The phrase with its first letter in upper case
 */
export function describeBookingMethodCapitalised(
  meta: BookingMethodMeta
): string {
  const phrase = describeBookingMethod(meta);
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
