/**
 * Where the org's asset sequence resumes after a bulk backfill.
 *
 * `generateBulkSequentialIdsEfficient` numbers every asset that has no
 * sequential id yet, then points the Postgres sequence at where new assets
 * should carry on from. Getting that landing point wrong is not cosmetic:
 * `Asset` is unique on `(organizationId, sequentialId)`, so a sequence sitting
 * below an id that already exists hands out a duplicate, `createAsset` takes a
 * P2002, and with only three attempts a wide enough gap fails the creation
 * outright in front of the user.
 *
 * The count of numbered assets and the highest number among them are the same
 * figure only while numbering is unbroken. Deleting a numbered asset drops the
 * count and leaves the maximum alone, and from then on they disagree by one
 * more for every deletion.
 *
 * @see {@link file://./sequential-id.server.ts}
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { db } from "~/database/db.server";

// why: the whole behaviour under test is which value reaches `setval`, so the
// raw calls are stubbed and asserted on rather than run against a database.
vi.mock("~/database/db.server", () => ({
  db: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

// @vitest-environment node

const { generateBulkSequentialIdsEfficient } = await import(
  "./sequential-id.server"
);

const ORG = "org-1";

/** Flattens a tagged-template call into something matchable. */
function sqlOf(strings: unknown): string {
  return Array.isArray(strings) ? strings.join("?") : String(strings);
}

/**
 * Stands the service up against an in-memory model of one organization.
 *
 * @param options.highestExisting - The highest number already issued, which is
 *   what the sequence has to clear. How many assets still CARRY one is not a
 *   parameter, because it is not something the service reads — which is the
 *   whole point: only the maximum bounds what is safe to issue next.
 * @param options.unnumbered - How many assets the backfill has to number
 * @returns The value handed to `setval`, and the `is_called` flag beside it
 */
function runBackfill({
  highestExisting,
  unnumbered,
}: {
  highestExisting: number;
  unnumbered: number;
}) {
  const state = { max: highestExisting };
  let setvalArgs: unknown[] = [];
  let setvalSql = "";

  vi.mocked(db.$queryRaw).mockImplementation(((strings: unknown) => {
    const sql = sqlOf(strings);
    if (sql.includes("max_num")) {
      return Promise.resolve([{ max_num: state.max }]);
    }
    if (sql.includes("IS NULL")) {
      return Promise.resolve(
        Array.from({ length: unnumbered }, (_, i) => ({ id: `asset-${i}` }))
      );
    }
    return Promise.resolve([]);
  }) as never);

  vi.mocked(db.$executeRaw).mockImplementation(((
    strings: unknown,
    ...values: unknown[]
  ) => {
    const sql = sqlOf(strings);
    if (sql.includes("setval")) {
      setvalArgs = values;
      setvalSql = sql;
      return Promise.resolve(1);
    }
    if (sql.includes("UPDATE")) {
      // The backfill numbers from `max + 1` upward, so the highest id in the
      // organization climbs by however many rows it just wrote.
      state.max += unnumbered;
      return Promise.resolve(unnumbered);
    }
    return Promise.resolve(0);
  }) as never);

  return generateBulkSequentialIdsEfficient(ORG).then(() => ({
    /** The number `setval` was given. */
    value: setvalArgs[1] as number,
    /**
     * The literal `is_called` argument. It is written into the statement
     * rather than bound, so it is read back off the SQL, not the values.
     */
    isCalled: /,\s*false\s*\)/.test(setvalSql),
    finalMax: state.max,
  }));
}

describe("generateBulkSequentialIdsEfficient — where the sequence resumes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes above the highest id when numbering has no gaps", async () => {
    const { value, finalMax } = await runBackfill({
      highestExisting: 10,
      unnumbered: 5,
    });

    expect(finalMax).toBe(15);
    expect(value).toBeGreaterThan(15);
  });

  it("resumes above the highest id even when assets have been deleted", async () => {
    // 20 numbers have been issued, and some of those assets have since been
    // deleted — so fewer than 20 assets carry an id, while ids up to 20 are
    // still spoken for. Anything derived from how many assets remain lands
    // below 20 and re-issues ids that exist; only the maximum bounds it.
    const { value, finalMax } = await runBackfill({
      highestExisting: 20,
      unnumbered: 3,
    });

    expect(finalMax).toBe(23);
    expect(value).toBeGreaterThan(23);
  });

  it("never resumes at or below an id that already exists", async () => {
    // The property the unique index cares about, stated directly.
    const { value, finalMax } = await runBackfill({
      highestExisting: 500,
      unnumbered: 0,
    });

    expect(value).toBeGreaterThan(finalMax);
  });

  it("still issues the first id to an organization with no assets", async () => {
    // An empty organization must start at 1. The two-argument `setval` makes
    // the next value one HIGHER than what it is given, so clamping to 1 there
    // silently burns the first id — the third argument is what avoids it.
    const { value, isCalled } = await runBackfill({
      highestExisting: 0,
      unnumbered: 0,
    });

    // `setval(seq, 1)` would leave the next value at 2; `setval(seq, 1, false)`
    // hands out 1 itself.
    expect(isCalled).toBe(true);
    expect(value).toBe(1);
  });
});
