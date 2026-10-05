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
 *   app bundle that sends nothing is recorded as `null`.
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
 * `method` applies to every row of the batch unless `selectedAssetIds` names
 * the row: the web scan pages let an operator tick a quantity-tracked row
 * "without scanning" in the same batch as real scans, and those rows are
 * recorded as `"selected"` while the rest keep the batch's `"scanned"`.
 */
export type BookingMethodProvenance = {
  surface: BookingSurface;
  /** The batch's method, or `null` when the client did not say. */
  method: BookingMethod | null;
  /** Rows of this batch that were ticked rather than scanned. */
  selectedAssetIds?: readonly string[];
};

/** What an event's `meta` carries about the method. */
export type BookingMethodMeta = {
  method: BookingMethod | null;
  surface: BookingSurface;
};

/**
 * Resolves the method one row of a batch is recorded with.
 *
 * @param provenance - What the route said about the batch
 * @param assetId - The row's asset
 * @returns The method for that row, or `null` when the client did not say
 */
export function resolveBookingMethod(
  provenance: BookingMethodProvenance,
  assetId: string
): BookingMethod | null {
  if (provenance.selectedAssetIds?.includes(assetId)) {
    return "selected";
  }
  return provenance.method;
}

/**
 * The `meta` keys an event carries for its method.
 *
 * Spread into the event's `meta` next to the quantity keys. Returns `{}` when
 * the caller has no provenance, so the event is written as before rather than
 * with a guessed surface.
 *
 * @param provenance - What the route said about the batch, if anything
 * @param assetId - The row the event is for
 * @returns `{ method, surface }`, or `{}` without provenance
 */
export function bookingMethodMeta(
  provenance: BookingMethodProvenance | undefined,
  assetId: string
): BookingMethodMeta | Record<string, never> {
  if (!provenance) return {};
  return {
    method: resolveBookingMethod(provenance, assetId),
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
 * A batch whose rows share one method reads like one row. A web scan batch
 * that mixed real scans with ticked rows reads `"scanned and selected on the
 * web"`, naming both rather than picking one.
 *
 * @param provenance - What the route said about the batch
 * @param assetIds - The rows the batch touched
 * @returns The phrase, without a leading comma or a full stop
 */
export function describeBatchMethod(
  provenance: BookingMethodProvenance,
  assetIds: readonly string[]
): string {
  const methods = new Set(
    assetIds.map((assetId) => resolveBookingMethod(provenance, assetId))
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
 * @param assetIds - The rows the batch touched; without them the batch's own
 *   method is used, which is right for the one-click actions
 * @returns `" (<phrase>)"` or `""`
 */
export function bookingMethodClause(
  provenance: BookingMethodProvenance | undefined,
  assetIds: readonly string[] = []
): string {
  if (!provenance) return "";
  return ` (${describeBatchMethod(provenance, assetIds)})`;
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
