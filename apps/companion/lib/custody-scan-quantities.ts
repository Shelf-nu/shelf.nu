/**
 * Per-row quantities for the Scan tab's Assign and Release custody modes.
 *
 * A quantity-tracked asset is handed over a number of units at a time, never
 * whole. So each such row in the scan list carries the units it may move and a
 * chosen quantity. On submit the whole scan goes in one bulk custody request:
 * whole assets as ids, quantity rows as ids plus a `quantities` map. The
 * server checks every unit count before it writes anything, so a refused
 * submit moves nothing and names the asset that asked for too much.
 *
 * MIRROR of the web scanner's custody drawers, cosmetic only:
 * `apps/webapp/app/components/scanner/drawer/custody-scan-quantities.ts`
 * (which units a row may move, and which holders count). The server enforces
 * the real rules on every write through the shared quantity-custody functions
 * (`apps/webapp/app/modules/custody/quantity-custody.server.ts`). A cap here
 * only bounds the input.
 * Extraction target: `@shelf/quantity-control`, once both apps read custody
 * rows of one shape.
 *
 * Where the numbers come from:
 * - Assign: {@link custodyAssignCap} over the asset detail endpoint, the same
 *   cap the asset screen's assign sheet uses. That cap does not subtract units
 *   allocated to a kit that is not in custody, so for such an asset the server
 *   can refuse a number this allows, naming the asset and its free units.
 * - Release: the QR resolve's `custodyList`. Only operator-assigned units
 *   (`releasableQuantity`) can be released here; units that came with a kit in
 *   custody go back by releasing the kit.
 *
 * @see {@link file://./batch-blockers.ts} the blockers that read these facts
 * @see {@link file://./../app/(tabs)/scanner.tsx} the scan list and submit
 * @see {@link file://./../app/(tabs)/assets/[id].tsx} the asset screen's sheets
 */
import { releaseCategory } from "@shelf/quantity-control";

import type {
  AssetCustodyListEntry,
  AssetQuantityBreakdown,
  AssetType,
  ConsumptionType,
} from "./api/types";

/** The two scan modes that move custody. */
export type CustodyScanMode = "assign_custody" | "release_custody";

/** One person holding operator-assigned units of an asset. */
type QuantityHolder = {
  teamMemberId: string;
  name: string;
  /** Units this holder can hand back through a release. */
  units: number;
};

/** What a quantity-tracked row knows about its units at scan time. */
export type ScanQuantityFacts = {
  /** Units an assign may hand over. */
  assignable: number;
  /** Operator holders, each with the units a release can take back. */
  holders: QuantityHolder[];
  /** True when some units are held because the asset's kit is in custody. */
  hasKitHeldUnits: boolean;
  /** Display unit, e.g. "m" or "pcs"; null when the asset has none. */
  unitOfMeasure: string | null;
  /** True when a release records the units as used up (one-way assets). */
  consumable: boolean;
};

/**
 * Units of a quantity-tracked asset that can be assigned to someone.
 *
 * The asset detail endpoint's `custodyAvailable`, falling back to `available`
 * and then to stock for servers that send less. A null breakdown means the
 * asset has no custody or booking activity, so all of its stock is free.
 *
 * @param asset - The asset as the detail endpoint sends it.
 * @returns The cap, never below zero.
 */
export function custodyAssignCap(asset: {
  quantity?: number | null;
  quantityBreakdown?: AssetQuantityBreakdown | null;
}): number {
  const breakdown = asset.quantityBreakdown ?? null;
  const cap =
    breakdown?.custodyAvailable ?? breakdown?.available ?? asset.quantity ?? 0;
  return Math.max(0, cap);
}

/**
 * Builds a quantity row's facts from what the scan resolved.
 *
 * @param args.scanned - The asset as the QR resolve sends it.
 * @param args.detail - The asset detail, fetched for assign scans; null when
 *   it was not fetched or did not load. Without it, free units are stock minus
 *   units held, which ignores units out on bookings; the server re-checks.
 * @returns The row's facts.
 */
export function buildQuantityFacts({
  scanned,
  detail,
}: {
  scanned: {
    quantity?: number | null;
    unitOfMeasure?: string | null;
    consumptionType?: ConsumptionType | null;
    custodyList?: AssetCustodyListEntry[];
  };
  detail: {
    quantity?: number | null;
    quantityBreakdown?: AssetQuantityBreakdown | null;
  } | null;
}): ScanQuantityFacts {
  const custodyList = scanned.custodyList ?? [];
  const held = custodyList.reduce((sum, entry) => sum + entry.quantity, 0);

  const holders: QuantityHolder[] = custodyList
    .map((entry) => ({
      teamMemberId: entry.custodian.id,
      name: entry.custodian.name,
      units: operatorUnits(entry),
    }))
    .filter((holder) => holder.units > 0);

  return {
    assignable: detail
      ? custodyAssignCap(detail)
      : Math.max(0, (scanned.quantity ?? 0) - held),
    holders,
    hasKitHeldUnits: custodyList.some(
      (entry) => operatorUnits(entry) < entry.quantity
    ),
    unitOfMeasure: scanned.unitOfMeasure?.trim() || null,
    consumable: releaseCategory(scanned.consumptionType) === "CONSUME",
  };
}

/**
 * A holder's operator-assigned units. A server that predates
 * `releasableQuantity` sends only the total, which is then used whole.
 */
function operatorUnits(entry: AssetCustodyListEntry): number {
  return entry.releasableQuantity ?? entry.quantity;
}

/**
 * Units this mode may move for a row: free units to assign, or the units its
 * holders can hand back.
 *
 * @param mode - Assign or release.
 * @param facts - The row's facts.
 * @returns The cap for the row's quantity.
 */
export function unitsFor(mode: CustodyScanMode, facts: ScanQuantityFacts) {
  return mode === "assign_custody"
    ? facts.assignable
    : facts.holders.reduce((sum, holder) => sum + holder.units, 0);
}

/**
 * The quantity a row starts at before the operator changes it.
 *
 * Assign starts at one unit, as the web scanner and the asset screen do:
 * handing out part of the stock is the usual scan. Release starts at every
 * held unit, as the asset screen's release does: giving it all back is the
 * usual return.
 *
 * @param mode - Assign or release.
 * @param facts - The row's facts.
 * @returns The starting quantity; 0 when the row has nothing to move.
 */
export function defaultQuantity(
  mode: CustodyScanMode,
  facts: ScanQuantityFacts
): number {
  const cap = unitsFor(mode, facts);
  if (cap <= 0) return 0;
  return mode === "assign_custody" ? 1 : cap;
}

/**
 * The quantity a row submits: the operator's choice, as a whole number from 1
 * up to the row's cap, or the default when they made none.
 *
 * @param mode - Assign or release.
 * @param facts - The row's facts.
 * @param chosen - What the operator set, if anything.
 * @returns The quantity to send.
 */
export function chosenQuantity(
  mode: CustodyScanMode,
  facts: ScanQuantityFacts,
  chosen?: number
): number {
  if (chosen === undefined) return defaultQuantity(mode, facts);
  const cap = unitsFor(mode, facts);
  const whole = Number.isFinite(chosen) ? Math.floor(chosen) : 1;
  return Math.min(Math.max(whole, 1), Math.max(cap, 1));
}

// ── Submit ─────────────────────────────────────────────

/** A row of the scan list, as much of it as a submit needs. */
export type CustodyListRow = {
  qrId: string;
  type: "asset" | "kit";
  /** Asset id for an asset row, kit id for a kit row. */
  targetId: string;
  title: string;
  /** Absent on servers that predate quantity tracking: read as INDIVIDUAL. */
  assetType?: AssetType;
  /** Quantity-tracked rows only. */
  quantityFacts?: ScanQuantityFacts;
  /** Quantity-tracked rows only: what the operator set, if anything. */
  chosenQuantity?: number;
};

/** One quantity row as the submit sends it. */
type QuantityRequest = {
  qrId: string;
  assetId: string;
  title: string;
  quantity: number;
  unitOfMeasure: string | null;
  /** True when a release records these units as used up. */
  consumable: boolean;
};

/** A row the plan will not send, with the reason the operator sees. */
type RefusedRow = { qrId: string; title: string; error: string };

/** How a submit is split across the two bulk requests. */
export type CustodySubmitPlan = {
  /** Whole assets: in the asset request, without a quantity. */
  individual: CustodyListRow[];
  /** Kits: the kit request. */
  kits: CustodyListRow[];
  /** Quantity rows: in the asset request, each with its units. */
  quantityRows: QuantityRequest[];
  /**
   * Quantity rows with no units to move. The blockers keep these out of a
   * submit, so this is empty in practice; a row here is reported as not done.
   */
  refused: RefusedRow[];
};

/**
 * Splits the scan list for a submit.
 *
 * @param mode - Assign or release.
 * @param rows - The scan list, in display order.
 * @returns The plan. Each list keeps the scan list's order.
 */
export function planCustodySubmit(
  mode: CustodyScanMode,
  rows: CustodyListRow[]
): CustodySubmitPlan {
  const plan: CustodySubmitPlan = {
    individual: [],
    kits: [],
    quantityRows: [],
    refused: [],
  };

  for (const row of rows) {
    if (row.type === "kit") {
      plan.kits.push(row);
      continue;
    }
    if (row.assetType !== "QUANTITY_TRACKED") {
      plan.individual.push(row);
      continue;
    }

    const facts = row.quantityFacts;
    if (!facts || unitsFor(mode, facts) <= 0) {
      plan.refused.push({
        qrId: row.qrId,
        title: row.title,
        error: "No units to move for this asset.",
      });
      continue;
    }

    plan.quantityRows.push({
      qrId: row.qrId,
      assetId: row.targetId,
      title: row.title,
      quantity: chosenQuantity(mode, facts, row.chosenQuantity),
      unitOfMeasure: facts.unitOfMeasure,
      consumable: facts.consumable,
    });
  }

  return plan;
}

/**
 * The asset request's body fields for a plan: every asset id, whole or by
 * units, and the units for the quantity rows. This is the shape the mobile
 * bulk custody routes take (`assetIds` + `quantities`).
 *
 * @param plan - The submit plan.
 * @returns The ids and the units per quantity-row asset id.
 */
export function bulkAssetRequest(plan: CustodySubmitPlan): {
  assetIds: string[];
  quantities: Record<string, number>;
} {
  const quantities: Record<string, number> = {};
  for (const row of plan.quantityRows) quantities[row.assetId] = row.quantity;
  return {
    assetIds: [
      ...plan.individual.map((row) => row.targetId),
      ...plan.quantityRows.map((row) => row.assetId),
    ],
    quantities,
  };
}

/** What came back from the two requests of a submit. */
type CustodySubmitOutcome = {
  /** The asset request's error; null when it succeeded or was not sent. */
  assetError: string | null;
  /** The kit request's error; null when it succeeded or was not sent. */
  kitError: string | null;
  /**
   * Quantity-tracked assets the asset request skipped. A server that takes a
   * `quantities` map never skips a row that carries one, so a count here
   * means the server predates the map and moved none of the units.
   */
  skippedQuantityTracked?: number;
};

/** Shown on quantity rows a server without `quantities` support skipped. */
const UNITS_NOT_SUPPORTED_ERROR =
  "This server does not take unit counts from the app yet. Use the asset's page for these units.";

/** Who the custody goes to, for the wording. */
export type CustodyAudience = {
  /** Assign only: the chosen custodian's display name. */
  custodianName?: string;
  isSelfService: boolean;
};

/** The confirm alert for a submit. */
type CustodyConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
};

/** The result alert, plus what the scan list keeps. */
type CustodySummary = {
  title: string;
  message: string;
  /** Rows the server accepted: they leave the scan list. */
  succeededQrIds: string[];
  /** Rows that failed: they stay in the scan list with this error. */
  rowErrors: Record<string, string>;
};

/**
 * The confirm alert for a submit, naming whole items and units separately.
 *
 * @param mode - Assign or release.
 * @param plan - The submit plan.
 * @param audience - Who receives the custody.
 * @returns The alert's title, message and confirm button label.
 */
export function describeCustodyConfirm(
  mode: CustodyScanMode,
  plan: CustodySubmitPlan,
  audience: CustodyAudience
): CustodyConfirm {
  const what = describeItems({
    individual: plan.individual.map((row) => row.title),
    kits: plan.kits.map((row) => row.title),
    quantityRows: plan.quantityRows,
  });

  if (mode === "release_custody") {
    const consumes = plan.quantityRows.some((row) => row.consumable);
    return {
      title: "Release Custody",
      message:
        `Release custody of ${what}?` +
        (consumes
          ? "\n\nOne-way units are recorded as used up. That permanently reduces total stock."
          : ""),
      confirmLabel: "Release",
    };
  }

  return audience.isSelfService
    ? {
        title: "Take Custody",
        message: `Take custody of ${what}?`,
        confirmLabel: "Take",
      }
    : {
        title: "Assign Custody",
        message: `Assign ${what} to ${audience.custodianName ?? "them"}?`,
        confirmLabel: "Assign",
      };
}

/**
 * The result alert for a submit, and which rows leave the scan list.
 *
 * Whole items and units are counted separately. The asset request carries the
 * whole assets and the quantity rows, and the server writes none of it when it
 * refuses, so those rows succeed or fail together. Kits go in their own
 * request, so a submit can still be partly done when one of the two refuses.
 * Rows that failed are listed with their error and stay in the scan list so
 * the operator can fix them and submit again.
 *
 * @param mode - Assign or release.
 * @param plan - The plan that was sent.
 * @param outcome - What each part of the submit returned.
 * @param audience - Who received the custody.
 * @returns The alert and the per-row results.
 */
export function summarizeCustodySubmit(
  mode: CustodyScanMode,
  plan: CustodySubmitPlan,
  outcome: CustodySubmitOutcome,
  audience: CustodyAudience
): CustodySummary {
  const succeededQrIds: string[] = [];
  const rowErrors: Record<string, string> = {};
  const failureLines: string[] = [];

  const done = {
    individual: [] as string[],
    kits: [] as string[],
    quantityRows: [] as QuantityRequest[],
  };

  const fail = (qrIds: string[], label: string, error: string) => {
    for (const qrId of qrIds) rowErrors[qrId] = error;
    failureLines.push(`${label}: ${error}`);
  };

  // The asset request carries whole assets and quantity rows together, and
  // the server writes none of it when it refuses, so they share one result.
  if (plan.individual.length > 0 || plan.quantityRows.length > 0) {
    if (outcome.assetError) {
      fail(
        [
          ...plan.individual.map((row) => row.qrId),
          ...plan.quantityRows.map((row) => row.qrId),
        ],
        describeItems({
          individual: plan.individual.map((row) => row.title),
          quantityRows: plan.quantityRows,
        }),
        outcome.assetError
      );
    } else {
      succeededQrIds.push(...plan.individual.map((row) => row.qrId));
      done.individual = plan.individual.map((row) => row.title);

      if (
        (outcome.skippedQuantityTracked ?? 0) > 0 &&
        plan.quantityRows.length
      ) {
        fail(
          plan.quantityRows.map((row) => row.qrId),
          describeItems({ quantityRows: plan.quantityRows }),
          UNITS_NOT_SUPPORTED_ERROR
        );
      } else {
        succeededQrIds.push(...plan.quantityRows.map((row) => row.qrId));
        done.quantityRows = plan.quantityRows;
      }
    }
  }

  if (plan.kits.length > 0) {
    if (outcome.kitError) {
      fail(
        plan.kits.map((row) => row.qrId),
        describeItems({ kits: plan.kits.map((row) => row.title) }),
        outcome.kitError
      );
    } else {
      succeededQrIds.push(...plan.kits.map((row) => row.qrId));
      done.kits = plan.kits.map((row) => row.title);
    }
  }

  for (const refused of plan.refused) {
    fail([refused.qrId], `"${refused.title}"`, refused.error);
  }

  const paragraphs: string[] = [];
  if (succeededQrIds.length > 0) {
    paragraphs.push(doneSentence(mode, describeItems(done), audience));
  }
  // A server that sends no asset type makes quantity-tracked rows read as
  // whole assets, which it then skips. Say so rather than claim they moved.
  const skipped = outcome.skippedQuantityTracked ?? 0;
  if (skipped > 0 && plan.quantityRows.length === 0) {
    paragraphs.push(
      `${skipped} quantity-tracked asset${skipped === 1 ? "" : "s"} skipped. ${
        mode === "assign_custody" ? "Assign" : "Release"
      } quantities from the asset's detail screen.`
    );
  }
  if (failureLines.length > 0) {
    paragraphs.push(
      ["Still in your list:", ...failureLines.map((line) => `• ${line}`)].join(
        "\n"
      )
    );
  }

  return {
    title:
      failureLines.length === 0
        ? "Done"
        : succeededQrIds.length > 0
        ? "Partly done"
        : "Not done",
    message: paragraphs.join("\n\n"),
    succeededQrIds,
    rowErrors,
  };
}

function doneSentence(
  mode: CustodyScanMode,
  what: string,
  audience: CustodyAudience
): string {
  if (mode === "release_custody") return `Released custody of ${what}.`;
  return audience.isSelfService
    ? `You have custody of ${what}.`
    : `Assigned ${what} to ${audience.custodianName ?? "them"}.`;
}

/**
 * Names a set of rows for an alert: one row by its title, several by count.
 * Whole items are counted as assets and kits; quantity rows by their units.
 *
 * - `"Tripod"`, `5 pcs of "Cable"`
 * - `2 assets, 1 kit and 15 m across 2 quantity-tracked assets`
 */
function describeItems({
  individual = [],
  kits = [],
  quantityRows = [],
}: {
  individual?: string[];
  kits?: string[];
  quantityRows?: Pick<
    QuantityRequest,
    "title" | "quantity" | "unitOfMeasure"
  >[];
}): string {
  const total = individual.length + kits.length + quantityRows.length;
  if (total === 1) {
    if (individual.length === 1) return `"${individual[0]}"`;
    if (kits.length === 1) return `"${kits[0]}"`;
  }

  const parts: string[] = [];
  if (individual.length > 0) parts.push(countOf(individual.length, "asset"));
  if (kits.length > 0) parts.push(countOf(kits.length, "kit"));
  if (quantityRows.length === 1) {
    const [row] = quantityRows;
    parts.push(
      `${unitsLabel(row.quantity, [row.unitOfMeasure])} of "${row.title}"`
    );
  } else if (quantityRows.length > 1) {
    const units = quantityRows.reduce((sum, row) => sum + row.quantity, 0);
    parts.push(
      `${unitsLabel(
        units,
        quantityRows.map((row) => row.unitOfMeasure)
      )} across ${quantityRows.length} quantity-tracked assets`
    );
  }
  return joinList(parts);
}

/**
 * "15 m" when every row shares a unit of measure, "15 units" otherwise.
 */
function unitsLabel(units: number, unitsOfMeasure: (string | null)[]): string {
  const [first] = unitsOfMeasure;
  const shared =
    first && unitsOfMeasure.every((unit) => unit === first) ? first : null;
  if (shared) return `${units} ${shared}`;
  return `${units} unit${units === 1 ? "" : "s"}`;
}

function countOf(n: number, noun: "asset" | "kit"): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** "a", "a and b", "a, b and c". */
function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
