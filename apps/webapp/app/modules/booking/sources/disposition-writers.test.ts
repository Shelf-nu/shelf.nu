/**
 * Inventory of every caller of the two disposition log writers.
 *
 * `createConsumptionLog` takes no lock and `recordStockChanges` relies on its
 * caller, yet every disposition log (RETURN, CONSUME, LOSS, DAMAGE) written
 * for a quantity-tracked asset on a booking must be written under that asset's
 * lock, and in a converted group must get shares in the same transaction (the
 * commit check fails otherwise). The asset lock is also the boundary a group's
 * conversion reads behind, so a caller that writes before locking can slip a
 * log past it.
 *
 * This test finds every top-level function (a declaration, or a `const`
 * bound to an arrow or function expression) in `app/modules` and
 * `app/routes` that calls either writer and compares the list with
 * {@link CALLERS}, where each entry
 * says whether it writes booking dispositions and how it takes the asset
 * lock. A new caller fails the test until it is classified here; a booking
 * disposition writer must also contain the lock and settlement calls listed
 * for it. No other file writes `ConsumptionLog` rows through the client
 * directly, so the writers are the only way in.
 *
 * Lock order. Inserting a log (or a share) with a `bookingId` makes Postgres
 * take FOR KEY SHARE on that `Booking` row for the foreign key, and FOR KEY
 * SHARE waits for a FOR UPDATE holder. A writer holding only an asset lock
 * that tagged a log with a booking would take that share after the asset,
 * the reverse of a booking writer (booking FOR UPDATE, then the assets), and
 * the two could deadlock. Only the booking disposition writers tag a log with
 * a booking, and they lock the booking first, so they already hold it when
 * the foreign key asks; every other caller writes logs with no booking (no
 * `bookingId` in its body, pinned below). The kit detach paths are outside
 * this inventory: they write no log, but with adoption on a LEGACY group they
 * convert seeds shares on another booking under the asset lock alone.
 *
 * @see {@link file://./settlement.ts}
 * @see {@link file://../service.server.ts} `checkinBooking`, `partialCheckinBooking`
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// @vitest-environment node

const APP = resolve(__dirname, "../../..");

/** How one caller of the writers is classified. */
type CallerEntry = {
  /** True when it writes disposition logs of a booking. */
  writesBookingDispositions: boolean;
  /** How it takes the asset lock before its reads, in words. */
  lock: string;
  /** Calls its body must contain (booking disposition writers). */
  mustCall: string[];
  /**
   * The one sorted, org-scoped `FOR UPDATE` statement a booking disposition
   * writer locks its assets with, after the booking lock.
   */
  assetLock?:
    | "lockEveryAssetForQuantityUpdate"
    | "lockAssetRowsForQuantityUpdate";
};

/** Calls every booking disposition writer must make, besides its asset lock. */
const BOOKING_WRITER_CALLS = [
  "lockBookingForStatusCheck",
  "openSettlement",
  "settleUnits",
  "commitSettlement",
];

/**
 * Every function that calls `createConsumptionLog(` or `recordStockChanges(`,
 * keyed `path#function` (path relative to `app/`).
 */
const CALLERS: Record<string, CallerEntry> = {
  "modules/booking/service.server.ts#checkinBooking": {
    writesBookingDispositions: true,
    lock: "booking lock, then lockEveryAssetForQuantityUpdate over the booking's quantity-tracked assets in one sorted statement, before openSettlement and every read that decides what comes back",
    mustCall: [...BOOKING_WRITER_CALLS, "lockEveryAssetForQuantityUpdate"],
    assetLock: "lockEveryAssetForQuantityUpdate",
  },
  "modules/booking/service.server.ts#partialCheckinBooking": {
    writesBookingDispositions: true,
    lock: "booking lock, then lockAssetRowsForQuantityUpdate over the session's quantity-tracked assets in one sorted statement that returns the rows, before openSettlement and every read that decides what comes back",
    mustCall: [...BOOKING_WRITER_CALLS, "lockAssetRowsForQuantityUpdate"],
    assetLock: "lockAssetRowsForQuantityUpdate",
  },
  "modules/asset/service.server.ts#createAsset": {
    writesBookingDispositions: false,
    lock: "none needed: the asset is created in the same transaction (INITIAL stock)",
    mustCall: [],
  },
  "modules/asset/service.server.ts#updateAsset": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the quantity change (ADJUSTMENT, no booking)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
  "modules/asset/service.server.ts#replaceAssetPlacements": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the placement writes (moves, no booking)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
  "modules/asset/service.server.ts#checkOutQuantity": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the custody write (CHECKOUT to a custodian)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
  "modules/asset/service.server.ts#releaseQuantity": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the custody release (custodian dispositions, no booking)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
  "modules/asset/service.server.ts#moveAssetLocationUnits": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the move (MOVE rows, no booking)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
  "modules/asset/service.server.ts#placeUnplacedUnits": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the placement (MOVE rows, no booking)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
  "modules/location/service.server.ts#updateLocationAssets": {
    writesBookingDispositions: false,
    lock: "lockAssetsForQuantityUpdate over the pools, one sorted statement (placement moves, no booking)",
    mustCall: ["lockAssetsForQuantityUpdate"],
  },
  "modules/consumption-log/service.server.ts#adjustQuantity": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the stock change (RESTOCK, ADJUSTMENT, LOSS or DAMAGE of the pool, no booking)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
  "routes/api+/mobile+/asset.update-location.ts#action": {
    writesBookingDispositions: false,
    lock: "lockAssetForQuantityUpdate before the placement change (moves, no booking)",
    mustCall: ["lockAssetForQuantityUpdate"],
  },
};

/** Every non-test `.ts`/`.tsx` file under `dir`, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** Source with block and line comments blanked, line count kept. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * A top-level function: a `function` declaration (group 1 is its name) or a
 * `const` bound to an arrow or function expression (group 2 is its name).
 */
const FUNCTION_LINE =
  /^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?const\s+(\w+)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\(|function\b|\w+\s*=>)/;

/** A direct write of a `ConsumptionLog` row through the Prisma client. */
const DIRECT_LOG_WRITE = /\.consumptionLog\s*\.\s*create(?:Many)?\(/;

/**
 * The only files that write `ConsumptionLog` rows through the client: the two
 * writers themselves. Every other path goes through them, so the inventory
 * above sees it.
 */
const DIRECT_LOG_WRITERS = [
  "modules/consumption-log/service.server.ts",
  "modules/consumption-log/stock-ledger.server.ts",
];

/** Every scanned source file, as `[path relative to app/, source]`. */
function scannedSources(): Array<[string, string]> {
  return [
    ...sourceFiles(join(APP, "modules")),
    ...sourceFiles(join(APP, "routes")),
  ].map((file) => [
    relative(APP, file).split("\\").join("/"),
    stripComments(readFileSync(file, "utf8")),
  ]);
}

/** A call of one of the writers (not their declarations). */
const WRITER_CALL = /\b(createConsumptionLog|recordStockChanges)\(/;

/**
 * The top-level functions of every scanned file that call a writer, with
 * their bodies (from the declaration to the next top-level function).
 */
function findCallers(): Map<string, string> {
  const callers = new Map<string, string>();
  for (const [path, source] of scannedSources()) {
    if (!WRITER_CALL.test(source)) continue;
    const lines = source.split("\n");
    const starts: Array<{ name: string; line: number }> = [];
    lines.forEach((line, index) => {
      const match = FUNCTION_LINE.exec(line);
      if (match) starts.push({ name: match[1] ?? match[2], line: index });
    });
    starts.forEach((start, index) => {
      const end = starts[index + 1]?.line ?? lines.length;
      const body = lines.slice(start.line, end);
      const calls = body
        .slice(1)
        .some(
          (line) =>
            WRITER_CALL.test(line) &&
            !/function\s+(createConsumptionLog|recordStockChanges)/.test(line)
        );
      if (calls) callers.set(`${path}#${start.name}`, body.join("\n"));
    });
  }
  return callers;
}

describe("disposition log writers", () => {
  const callers = findCallers();

  it("lists every caller of createConsumptionLog and recordStockChanges", () => {
    expect([...callers.keys()].sort()).toEqual(Object.keys(CALLERS).sort());
  });

  it("writes ConsumptionLog rows through the client only in the two writers", () => {
    const direct = scannedSources()
      .filter(([, source]) => DIRECT_LOG_WRITE.test(source))
      .map(([path]) => path)
      .sort();
    expect(direct).toEqual([...DIRECT_LOG_WRITERS].sort());
  });

  it.each(Object.entries(CALLERS))(
    "%s takes the lock it is listed with",
    (key, entry) => {
      const body = callers.get(key) ?? "";
      for (const call of entry.mustCall) {
        expect(body, `${key} must call ${call}`).toMatch(
          new RegExp(`\\b${call}\\(`)
        );
      }
    }
  );

  it("names a booking disposition writer only when it settles by source", () => {
    for (const [key, entry] of Object.entries(CALLERS)) {
      const settles = /\bsettleUnits\(/.test(callers.get(key) ?? "");
      expect(settles, key).toBe(entry.writesBookingDispositions);
    }
  });

  it("tags a log with a booking only in a booking disposition writer", () => {
    for (const [key, entry] of Object.entries(CALLERS)) {
      if (entry.writesBookingDispositions) continue;
      expect(callers.get(key) ?? "", key).not.toMatch(/\bbookingId\b/);
    }
  });

  it("locks the booking and the assets before opening the settlement", () => {
    for (const [key, entry] of Object.entries(CALLERS)) {
      if (!entry.writesBookingDispositions) continue;
      const body = callers.get(key) ?? "";
      const at = (call: string) => body.search(new RegExp(`\\b${call}\\(`));
      const assetLock = entry.assetLock ?? "lockEveryAssetForQuantityUpdate";
      expect(at(assetLock), key).toBeGreaterThan(-1);
      expect(at("lockBookingForStatusCheck"), key).toBeLessThan(at(assetLock));
      expect(at(assetLock), key).toBeLessThan(at("openSettlement"));
      expect(at("openSettlement"), key).toBeLessThan(
        at("createConsumptionLog")
      );
      expect(at("createConsumptionLog"), key).toBeLessThan(
        at("commitSettlement")
      );
    }
  });
});
