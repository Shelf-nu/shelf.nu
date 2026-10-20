/**
 * Low-Stock Email Copy
 *
 * Every sentence the low-stock alert and the back-in-stock email print, built
 * from plain data. Both the HTML and the plain-text body read from here, so the
 * two can never say different things.
 *
 * Pure on purpose: no database, no `~/utils/env` (it throws at import without
 * env vars). The notifier loads the facts; this module only words them.
 *
 * Sentences with bold words are {@link CopySegment} lists, so the HTML can
 * style those words and the plain text can print the same words without it.
 * Links are never inside a sentence: a row's link sits under its value, which
 * reads the same in HTML and in plain text.
 *
 * @see {@link file://../modules/consumption-log/low-stock.server.ts} - loads the facts and sends
 * @see {@link file://./components/stock-level-email.tsx} - renders them
 */

import type { ConsumptionCategory } from "@prisma/client";
import { ASSET_EDIT_ADJUSTMENT_NOTE } from "~/modules/consumption-log/constants";
import { formatDate, type ResolvedFormatPrefs } from "~/utils/date-format";
import {
  resolveTeamMemberName,
  resolveUserDisplayName,
  type TeamMemberNameFields,
  type UserNameFields,
} from "~/utils/user";

/**
 * How old the newest `ConsumptionLog` row may be and still explain the change
 * that triggered the mail. The notifier runs right after the mutation, so a
 * row that caused it is seconds old; an older one belongs to an earlier change.
 */
export const MOVEMENT_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * How far apart the rows of one operation can be written. A booking check-in
 * writes its rows one by one inside a transaction, so their timestamps differ
 * rather than tie, and that transaction may run for up to 15 seconds (its
 * timeout in `checkinBooking`). Keep the two equal. The cost of the width: two
 * check-ins of the same booking by the same person within 15 seconds read as
 * one.
 */
export const MOVEMENT_GROUP_WINDOW_MS = 15 * 1000;

/** The "Where it is" value when the asset has no `AssetLocation` rows. */
export const NOT_PLACED = "Not placed at a location";

/** Relative link to the asset index filtered to low-stock items. */
export const LOW_STOCK_LIST_PATH = "/assets?lowStockOnly=true";

/** Heading of the back-in-stock mail. */
export const RECOVERED_HEADING = "Back in stock";

/** The yellow box of the back-in-stock mail. */
export const RECOVERED_NOTICE = "No action needed.";

/** A run of copy. Bold runs render as `<strong>` in HTML. */
export type CopySegment = { text: string; bold?: boolean };

/** A link under a fact row. `href` is relative; renderers prefix the server URL. */
export type CopyLink = { text: string; href: string };

/**
 * A `ConsumptionLog` row of the asset, in the shape the notifier selects it
 * (`performedBy` via `USER_NAME_SELECT`, the custodian with its user account so
 * a display name wins over the stored team-member name). `userId` and
 * `custodianId` tell the rows of one operation apart from their neighbours.
 */
export type StockMovementLog = {
  category: ConsumptionCategory;
  quantity: number;
  note: string | null;
  createdAt: Date;
  userId: string;
  performedBy: UserNameFields | null;
  custodianId: string | null;
  custodian: TeamMemberNameFields | null;
  booking: { id: string; name: string } | null;
};

/**
 * The newest change of the asset's minimum, as the notifier reads it from the
 * `ASSET_MIN_QUANTITY_CHANGED` activity event. A minimum change writes no
 * `ConsumptionLog` row, so this is the only record of it.
 */
export type MinimumChange = {
  /** The minimum before the change; null when the asset had none. */
  from: number | null;
  to: number;
  createdAt: Date;
  /** Who changed it, from the event's actor snapshot; null when unknown. */
  by: UserNameFields | null;
};

/** The "What happened" sentence. */
export type StockMovement = {
  text: string;
  /** Relative URL of the booking the sentence names, e.g. `/bookings/{id}`. */
  href?: string;
};

/**
 * A placement row as `assetLocation.findMany` returns it. `assetKitId` set
 * means a kit-driven row: units of a kit slice placed at the kit's location.
 */
export type PlacementRow = {
  quantity: number;
  assetKitId: string | null;
  location: { name: string };
};

/**
 * Operator custody taken from a location (`Custody.locationId` set,
 * `kitCustodyId` null), as `custody.findMany` returns it. Custody never
 * changes a placement's count, so these units are still part of it.
 */
export type CustodySourceRow = { quantity: number; location: { name: string } };

/**
 * The order of the parts of a combined sentence: what took stock away first,
 * then what brought it back.
 */
const CATEGORY_ORDER: ConsumptionCategory[] = [
  "CONSUME",
  "LOSS",
  "DAMAGE",
  "CHECKOUT",
  "RETURN",
  "RESTOCK",
  "INITIAL",
  "ADJUSTMENT",
  "MOVE",
  "OPENING_BALANCE",
];

/** One row of the grey facts panel. */
export type FactRow = {
  label: "What happened" | "Where it is" | "Out with people" | "Also low";
  value: string;
  link?: CopyLink;
};

/** The numbers every subject and lead sentence reads. */
type StockNumbers = {
  assetTitle: string;
  available: number;
  minQuantity: number;
  unitOfMeasure: string | null;
};

/**
 * Formats a count with its unit label.
 *
 * `null` and `""` both mean the asset has no unit, and then the bare number is
 * printed. There is deliberately no default word: "2 units" on an asset that
 * counts boxes would be wrong, while "2" is always true.
 *
 * @param n - The count
 * @param unit - `Asset.unitOfMeasure`
 * @returns `"2 Units"`, or `"2"` without a unit
 */
export function formatQuantity(n: number, unit: string | null | undefined) {
  const label = unit?.trim();
  return label ? `${n} ${label}` : `${n}`;
}

/**
 * Clamps availability for display. Custody can exceed stock after the total is
 * lowered, which makes `available` negative; a reader should see 0. Display
 * only: the trigger compares the raw value.
 *
 * @param n - Total quantity minus units in custody
 * @returns `n`, or 0 when `n` is negative
 */
export function displayAvailable(n: number) {
  return Math.max(0, n);
}

/**
 * Whether the alert reads as "Out of stock" rather than "Low stock".
 *
 * @param available - Raw availability (may be negative)
 */
export function isOutOfStock(available: number) {
  return available <= 0;
}

/**
 * Joins runs into the plain sentence they spell.
 *
 * @param segments - The runs
 */
export function segmentsToText(segments: CopySegment[]) {
  return segments.map((s) => s.text).join("");
}

/** `" on {date} at {time}"` in the recipient's format preferences. */
function onDateAtTime(d: Date, prefs: ResolvedFormatPrefs) {
  const date = formatDate(d, prefs);
  const time = formatDate(d, prefs, { onlyTime: true });
  return ` on ${date} at ${time}`;
}

/** `" by Dana Reyes"`, or `""` when there is no name to print. */
function byName(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? ` by ${trimmed}` : "";
}

/** `" to Dana Reyes"`, or `""` when there is no name to print. */
function toName(name: string | null | undefined) {
  const trimmed = name?.trim();
  return trimmed ? ` to ${trimmed}` : "";
}

/** `"a"`, `"a and b"`, `"a, b and c"`. */
function joinList(items: string[]) {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * What one row did to the stock, without who or when: `"3 Units used up"`.
 *
 * @param capitalize - Whether this part opens the sentence
 */
function movementHead(
  log: StockMovementLog,
  unitOfMeasure: string | null,
  capitalize: boolean
) {
  const qty = formatQuantity(log.quantity, unitOfMeasure);
  switch (log.category) {
    case "CHECKOUT":
      return `${qty} checked out${toName(
        resolveTeamMemberName(log.custodian)
      )}`;
    case "CONSUME":
      return `${qty} used up`;
    case "LOSS":
      return `${qty} reported lost`;
    case "DAMAGE":
      return `${qty} reported damaged`;
    case "RETURN":
      return `${qty} returned`;
    case "RESTOCK":
      return `${qty} restocked`;
    case "ADJUSTMENT":
      return capitalize ? "Quantity adjusted" : "quantity adjusted";
    case "INITIAL":
      return `${qty} added as starting stock`;
    // The two ledger bookkeeping categories change no total, and the mail's
    // reads skip them. Worded anyway so every category reads as a sentence.
    case "MOVE":
      return `${qty} moved`;
    case "OPENING_BALANCE":
      return `${qty} counted when stock history began`;
  }
}

/**
 * Picks the rows of the newest operation from the asset's log rows.
 *
 * A booking check-in writes one row per disposition (returned, used up, lost,
 * damaged) and per booking slice, and releasing custody writes a used-up row
 * beside a returned one. Those rows share the acting user and the booking or
 * custodian, and land within {@link MOVEMENT_GROUP_WINDOW_MS} of each other. A
 * row with neither a booking nor a custodian comes from a single-row write (an
 * adjustment, a restock, an asset edit), so it stands alone.
 *
 * @param logs - The asset's newest `ConsumptionLog` rows, newest first
 * @returns The newest operation's rows, newest first; empty when there are none
 */
export function pickLatestMovement(
  logs: StockMovementLog[]
): StockMovementLog[] {
  const [newest] = logs;
  if (!newest) {
    return [];
  }
  const bookingId = newest.booking?.id ?? null;
  if (!bookingId && !newest.custodianId) {
    return [newest];
  }
  const cutoff = newest.createdAt.getTime() - MOVEMENT_GROUP_WINDOW_MS;
  return logs.filter(
    (log) =>
      log.createdAt.getTime() >= cutoff &&
      log.userId === newest.userId &&
      (log.booking?.id ?? null) === bookingId &&
      log.custodianId === newest.custodianId
  );
}

/**
 * Sums one operation's rows per category, in {@link CATEGORY_ORDER}, so a
 * check-in over several booking slices reads as one count per disposition.
 * Each merged row keeps the newest row of its category, including its note.
 */
function mergeByCategory(logs: StockMovementLog[]) {
  const merged = new Map<ConsumptionCategory, StockMovementLog>();
  for (const log of logs) {
    const seen = merged.get(log.category);
    merged.set(
      log.category,
      seen ? { ...seen, quantity: seen.quantity + log.quantity } : log
    );
  }
  return [...merged.values()].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category)
  );
}

/**
 * Words one operation. The rows' categories decide the sentence, not the kind
 * of mail: a restock can close a low-stock episode and a return into custody
 * can open one.
 *
 * A single category keeps its own sentence: a return names who brought the
 * units back, a used-up row names its booking, an adjustment its note.
 * Several categories share one sentence naming who recorded them and the
 * booking they belong to.
 *
 * @param parts - The operation's rows merged per category, never empty
 * @param at - When the operation happened (its newest row)
 */
function describeOperation(
  parts: StockMovementLog[],
  at: Date,
  unitOfMeasure: string | null,
  prefs: ResolvedFormatPrefs
): StockMovement {
  const [first] = parts;
  const single = parts.length === 1;
  const heads = joinList(
    parts.map((log, index) => movementHead(log, unitOfMeasure, index === 0))
  );
  const who =
    single && first.category === "RETURN"
      ? byName(resolveTeamMemberName(first.custodian))
      : byName(resolveUserDisplayName(first.performedBy));
  const when = onDateAtTime(at, prefs);

  if (single && first.category === "ADJUSTMENT") {
    /** A note is free text; fold it onto one line so the row stays one line. */
    const note = first.note?.replace(/\s+/g, " ").trim();
    const detail =
      note === ASSET_EDIT_ADJUSTMENT_NOTE
        ? " on the asset edit page"
        : note
        ? ` "${note}"`
        : "";
    return { text: `${heads}${who}${detail}${when}` };
  }

  const bookingName = first.booking?.name.trim();
  if (
    first.booking &&
    bookingName &&
    (!single || first.category === "CONSUME")
  ) {
    return {
      text: `${heads}${who} during booking ${bookingName}${when}`,
      href: `/bookings/${first.booking.id}`,
    };
  }
  return { text: `${heads}${who}${when}` };
}

/**
 * Whether a record is recent enough to be the change that triggered the mail.
 *
 * @param log - The newest `ConsumptionLog` row or minimum change, or null
 * @param now - The moment the mail is built
 */
export function isFreshMovement(
  log: Pick<StockMovementLog, "createdAt"> | null | undefined,
  now: Date
): log is Pick<StockMovementLog, "createdAt"> {
  return (
    log != null &&
    now.getTime() - log.createdAt.getTime() <= MOVEMENT_FRESHNESS_MS
  );
}

/**
 * The sentence for one save of the asset edit form that changed both the
 * quantity and the minimum. `updateAsset` writes the adjustment row first and
 * the minimum-change event after it, so on its own the event would win as the
 * newest record and the sentence would leave out the stock change.
 *
 * Matches only that shape: a single fresh adjustment carrying
 * {@link ASSET_EDIT_ADJUSTMENT_NOTE}, and a fresh minimum change no more than
 * {@link MOVEMENT_GROUP_WINDOW_MS} after it.
 *
 * @returns The combined sentence, or null when the records are not one edit
 */
function describeEditOfBoth(
  latest: StockMovementLog[],
  minimumChange: MinimumChange | null,
  prefs: ResolvedFormatPrefs,
  now: Date
): StockMovement | null {
  const [log] = latest;
  if (
    latest.length !== 1 ||
    log.category !== "ADJUSTMENT" ||
    log.note !== ASSET_EDIT_ADJUSTMENT_NOTE ||
    !isFreshMovement(log, now) ||
    !isFreshMovement(minimumChange, now)
  ) {
    return null;
  }
  const gap = minimumChange.createdAt.getTime() - log.createdAt.getTime();
  if (gap < 0 || gap > MOVEMENT_GROUP_WINDOW_MS) {
    return null;
  }
  const minimum =
    minimumChange.from === null
      ? `minimum set to ${minimumChange.to}`
      : `minimum changed from ${minimumChange.from} to ${minimumChange.to}`;
  return {
    text: `Quantity adjusted and ${minimum}${byName(
      resolveUserDisplayName(log.performedBy)
    )} on the asset edit page${onDateAtTime(log.createdAt, prefs)}`,
  };
}

/**
 * Builds the "What happened" sentence.
 *
 * Two records can explain the change, each only while it is fresh (see
 * {@link MOVEMENT_FRESHNESS_MS}): the newest operation in the log, whose rows
 * {@link pickLatestMovement} picks, and the newest minimum change, which writes
 * no log row. When both are fresh the newer one wins, except when one asset
 * edit changed both: then the sentence names both (see
 * {@link describeEditOfBoth}).
 *
 * With no fresh record, the mail falls back to naming whoever made the change.
 * That sentence must stay true whatever the trigger was, so it says "stock or
 * minimum", never "quantity". With no fresh record and no acting user there is
 * nothing true to say, so the row is left out, even when older records exist.
 *
 * @param params.logs - The asset's newest `ConsumptionLog` rows, newest first
 * @param params.minimumChange - The asset's newest minimum change, or null
 * @param params.actingUser - The user whose action triggered the check, or null
 * @param params.prefs - The recipient's resolved format preferences
 * @param params.unitOfMeasure - `Asset.unitOfMeasure`
 * @param params.now - The moment to measure freshness against (injected for tests)
 * @returns The sentence, or null when the row is left out
 */
export function describeStockMovement({
  logs,
  minimumChange,
  actingUser,
  prefs,
  unitOfMeasure,
  now = new Date(),
}: {
  logs: StockMovementLog[];
  minimumChange: MinimumChange | null;
  actingUser: UserNameFields | null;
  prefs: ResolvedFormatPrefs;
  unitOfMeasure: string | null;
  now?: Date;
}): StockMovement | null {
  const latest = pickLatestMovement(logs);
  const logIsFresh = isFreshMovement(latest[0], now);
  const editedTogether = describeEditOfBoth(latest, minimumChange, prefs, now);
  if (editedTogether) {
    return editedTogether;
  }
  if (
    isFreshMovement(minimumChange, now) &&
    (!logIsFresh ||
      minimumChange.createdAt.getTime() > latest[0].createdAt.getTime())
  ) {
    const by = byName(resolveUserDisplayName(minimumChange.by));
    const when = onDateAtTime(minimumChange.createdAt, prefs);
    return {
      text:
        minimumChange.from === null
          ? `Minimum set to ${minimumChange.to}${by}${when}`
          : `Minimum changed from ${minimumChange.from} to ${minimumChange.to}${by}${when}`,
    };
  }
  if (logIsFresh) {
    return describeOperation(
      mergeByCategory(latest),
      latest[0].createdAt,
      unitOfMeasure,
      prefs
    );
  }
  if (!actingUser) {
    return null;
  }
  return {
    text: `Stock or minimum was changed${byName(
      resolveUserDisplayName(actingUser)
    )}`,
  };
}

/**
 * Builds the "Where it is" value: every location the asset is placed at,
 * largest first, with the same split the asset and location pages show.
 *
 * - Manual placements are summed per location. Units taken into custody from
 *   that location stay in its count (custody never moves a placement), so the
 *   value says how many of them are in custody: `"Ogden warehouse: 10 (6 in
 *   custody)"`.
 * - Kit-driven placements are listed apart (`"+ 5 in kits"`), never added to
 *   the manual count. The two axes are bounded separately, so 100 placed by
 *   hand plus a 50-unit kit slice is valid for a 100-unit asset, and a sum
 *   would print more units than the asset has.
 *
 * @param rows - The asset's `AssetLocation` rows with their location name
 * @param custody - Operator custody per source location; omit when unknown
 * @returns `"Ogden warehouse: 10 (6 in custody), Van 3: 1 + 5 in kits"`, or
 *   {@link NOT_PLACED}
 */
export function describePlacements(
  rows: PlacementRow[],
  custody: CustodySourceRow[] = []
) {
  // Location names are unique per workspace, case-insensitively (the
  // `Location_name_organizationId_key` index), so a name keys one location.
  const totals = new Map<
    string,
    { manual: number; kits: number; inCustody: number }
  >();
  const entry = (name: string) => {
    let found = totals.get(name);
    if (!found) {
      found = { manual: 0, kits: 0, inCustody: 0 };
      totals.set(name, found);
    }
    return found;
  };
  for (const row of rows) {
    const found = entry(row.location.name);
    if (row.assetKitId) {
      found.kits += row.quantity;
    } else {
      found.manual += row.quantity;
    }
  }
  for (const row of custody) {
    // Custody only annotates a location the asset is placed at.
    const found = totals.get(row.location.name);
    if (found) {
      found.inCustody += row.quantity;
    }
  }
  const placed = [...totals.entries()]
    .filter(([, t]) => t.manual > 0 || t.kits > 0)
    .sort(([aName, a], [bName, b]) => {
      const diff = b.manual + b.kits - (a.manual + a.kits);
      return diff === 0 ? aName.localeCompare(bName) : diff;
    });
  if (placed.length === 0) {
    return NOT_PLACED;
  }
  return placed
    .map(([name, t]) => {
      const parts: string[] = [];
      if (t.manual > 0) {
        const held = Math.min(t.inCustody, t.manual);
        parts.push(
          held > 0 ? `${t.manual} (${held} in custody)` : `${t.manual}`
        );
      }
      if (t.kits > 0) {
        parts.push(`${t.kits} in kits`);
      }
      return `${name}: ${parts.join(" + ")}`;
    })
    .join(", ");
}

/**
 * Subject of the alert. The numbers are in the subject so the inbox list alone
 * answers "how bad is it".
 *
 * @returns `Low stock: {title} (2 Units left, minimum 5)`, or
 *   `Out of stock: {title}` when nothing is available
 */
export function lowStockSubject({
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
}: StockNumbers) {
  if (isOutOfStock(available)) {
    return `Out of stock: ${assetTitle}`;
  }
  const left = formatQuantity(displayAvailable(available), unitOfMeasure);
  return `Low stock: ${assetTitle} (${left} left, minimum ${minQuantity})`;
}

/**
 * Subject of the back-in-stock mail.
 *
 * @returns `Back in stock: {title} (14 Units, minimum 5)`
 */
export function recoveredSubject({
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
}: StockNumbers) {
  const current = formatQuantity(displayAvailable(available), unitOfMeasure);
  return `Back in stock: ${assetTitle} (${current}, minimum ${minQuantity})`;
}

/**
 * The preheader: the grey line most inboxes show after the subject.
 *
 * @param params.movement - The "What happened" sentence, or null
 * @param params.placements - The "Where it is" value from
 *   {@link describePlacements}, or null when the placements could not be read
 * @returns e.g. `2 Units used up by Dana Reyes on 24 Sep 2026 at 20:53. Stock is at Ogden warehouse: 2.`
 */
export function preheader({
  movement,
  placements,
}: {
  movement: StockMovement | null;
  placements: string | null;
}) {
  const parts = [
    ...(movement ? [`${movement.text}.`] : []),
    ...(placements === null
      ? []
      : [
          placements === NOT_PLACED
            ? `${NOT_PLACED}.`
            : `Stock is at ${placements}.`,
        ]),
  ];
  return parts.join(" ");
}

/**
 * The "Also low" sentence.
 *
 * Says "total stock" because the count and the list it links to
 * ({@link LOW_STOCK_LIST_PATH}) compare `Asset.quantity` to the minimum,
 * ignoring custody, while the alert itself fires on available units. An item
 * low only because of custody is therefore not in the count.
 *
 * @param n - How many OTHER assets in the workspace have total stock at or
 *   below their minimum
 */
export function otherLowSentence(n: number) {
  return n === 1
    ? "1 other item has total stock at or below its minimum"
    : `${n} other items have total stock at or below their minimum`;
}

/**
 * The rows of the grey facts panel, in display order. HTML and plain text both
 * render this list, so they always carry the same facts.
 *
 * - "What happened": only when there is a sentence; links its booking.
 * - "Where it is": whenever the placements were read, including "not placed".
 *   A failed read leaves the row out rather than claim the asset is unplaced.
 * - "Out with people": only when units are in custody, so the available count
 *   in the lead never contradicts the total on the asset page.
 * - "Also low": only when other items are low; links the filtered list.
 *
 * @param params.movement - From {@link describeStockMovement}
 * @param params.placements - From {@link describePlacements}, or null when the
 *   placements could not be read
 * @param params.inCustody - Units of this asset held in custody
 * @param params.otherLowCount - Other assets in the workspace at or below their minimum
 * @param params.unitOfMeasure - `Asset.unitOfMeasure`
 */
export function buildFactRows({
  movement,
  placements,
  inCustody,
  otherLowCount,
  unitOfMeasure,
}: {
  movement: StockMovement | null;
  placements: string | null;
  inCustody: number;
  otherLowCount: number;
  unitOfMeasure: string | null;
}): FactRow[] {
  const rows: FactRow[] = [];
  if (movement) {
    rows.push({
      label: "What happened",
      value: movement.text,
      ...(movement.href
        ? { link: { text: "Open booking", href: movement.href } }
        : {}),
    });
  }
  if (placements !== null) {
    rows.push({ label: "Where it is", value: placements });
  }
  if (inCustody > 0) {
    rows.push({
      label: "Out with people",
      value: formatQuantity(inCustody, unitOfMeasure),
    });
  }
  if (otherLowCount > 0) {
    rows.push({
      label: "Also low",
      value: otherLowSentence(otherLowCount),
      link: { text: "See all low-stock items", href: LOW_STOCK_LIST_PATH },
    });
  }
  return rows;
}

/**
 * Heading of the alert mail.
 *
 * @param available - Raw availability (may be negative)
 */
export function lowStockHeading(available: number) {
  return isOutOfStock(available) ? "Out of stock" : "Low stock";
}

/**
 * Lead sentence of the alert mail.
 *
 * @param params - The asset's numbers and the workspace name
 * @returns Runs with the title and quantities bold
 */
export function lowStockLead({
  assetTitle,
  organizationName,
  available,
  minQuantity,
  unitOfMeasure,
}: StockNumbers & { organizationName: string }): CopySegment[] {
  const min = formatQuantity(minQuantity, unitOfMeasure);
  const opening: CopySegment[] = [
    { text: assetTitle, bold: true },
    { text: ` in ${organizationName} ` },
  ];
  if (isOutOfStock(available)) {
    return [
      ...opening,
      { text: "is out of stock. Your minimum is " },
      { text: min, bold: true },
      { text: "." },
    ];
  }
  return [
    ...opening,
    { text: "is down to " },
    { text: formatQuantity(available, unitOfMeasure), bold: true },
    { text: ". Your minimum is " },
    { text: min, bold: true },
    { text: "." },
  ];
}

/**
 * Lead sentence of the back-in-stock mail.
 *
 * @param params - The asset's numbers and the workspace name
 * @returns Runs with the title and quantities bold
 */
export function recoveredLead({
  assetTitle,
  organizationName,
  available,
  minQuantity,
  unitOfMeasure,
}: StockNumbers & { organizationName: string }): CopySegment[] {
  const current = formatQuantity(displayAvailable(available), unitOfMeasure);
  return [
    { text: assetTitle, bold: true },
    { text: ` in ${organizationName} is back to ` },
    { text: current, bold: true },
    { text: ", above your minimum of " },
    { text: formatQuantity(minQuantity, unitOfMeasure), bold: true },
    { text: "." },
  ];
}

/**
 * The yellow box of the alert mail: what to do, and what happens after.
 *
 * @param minQuantity - The asset's minimum
 * @param unitOfMeasure - `Asset.unitOfMeasure`
 */
export function restockNotice(
  minQuantity: number,
  unitOfMeasure: string | null
) {
  const min = formatQuantity(minQuantity, unitOfMeasure);
  return `Restock and adjust the quantity on the asset, and this alert clears. You get a "back in stock" email once it is above ${min} again.`;
}

/**
 * The salutation.
 *
 * @param greetingName - From `resolveUserGreetingName`, possibly empty
 * @returns `Hey Sam,`, or `Hey,` without a name
 */
export function greeting(greetingName: string) {
  const name = greetingName.trim();
  return name ? `Hey ${name},` : "Hey,";
}

/**
 * The "why did I get this" footer. Recipients are every member whose role
 * receives inventory alerts (`notifications.inventoryAlerts` in
 * `@shelf/permissions`), so it names that reason rather than the roles, and
 * it names the one setting that controls when the mail fires.
 *
 * @param params.email - The address this copy was sent to
 * @param params.organizationName - The workspace name (bold in HTML)
 */
export function recipientFooter({
  email,
  organizationName,
}: {
  email: string;
  organizationName: string;
}): CopySegment[] {
  return [
    {
      text: `This email was sent to ${email} because your role in `,
    },
    { text: `"${organizationName}"`, bold: true },
    {
      text: " receives inventory alerts, and everyone with such a role received it. To change when it fires, edit the minimum quantity on the asset.",
    },
  ];
}
