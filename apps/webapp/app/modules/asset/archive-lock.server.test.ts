/**
 * The archive lock is what makes archiving and booking mutually exclusive.
 * Its value is entirely in the SQL it emits, so that is what these assert:
 * the right rows, scoped to the caller's org, in a deterministic order.
 *
 * @see {@link file://./archive-lock.server.ts}
 */
import { describe, expect, it, vi } from "vitest";

import { lockAssetsForArchiveGuard } from "./archive-lock.server";

/**
 * Minimal tx double capturing the tagged-template call.
 *
 * why: `$queryRaw` is a tagged template, so the arguments arrive as a strings
 * array plus interpolated values. Reading them directly is the only way to
 * assert on the emitted SQL without a live database.
 */
function makeTx() {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join("?"), values });
      return Promise.resolve([]);
    }),
  };
}

describe("lockAssetsForArchiveGuard", () => {
  it("locks the given assets FOR UPDATE, scoped to the caller's org", async () => {
    const tx = makeTx();

    await lockAssetsForArchiveGuard(tx, ["a2", "a1"], "org-1");

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.calls[0].sql).toContain("FOR UPDATE");
    expect(tx.calls[0].sql).toContain('"organizationId"');
    expect(tx.calls[0].values[1]).toBe("org-1");
  });

  it("sorts ids so two overlapping transactions cannot deadlock", async () => {
    // why: Postgres takes row locks in the order rows are returned. Two
    // transactions locking {a1,a2} in opposite orders would deadlock against
    // each other, so the order must not depend on caller input.
    const tx = makeTx();

    await lockAssetsForArchiveGuard(tx, ["b", "a", "c"], "org-1");

    expect(tx.calls[0].values[0]).toEqual(["a", "b", "c"]);
    expect(tx.calls[0].sql).toContain("ORDER BY id");
  });

  it("dedupes ids", async () => {
    // why: an asset can arrive both standalone and as a kit slice in the same
    // booking, so the union handed to this helper legitimately repeats ids.
    const tx = makeTx();

    await lockAssetsForArchiveGuard(tx, ["a", "a", "b"], "org-1");

    expect(tx.calls[0].values[0]).toEqual(["a", "b"]);
  });

  it("takes no lock at all for an empty list", async () => {
    // why: a booking with no assets is legal; emitting `id = ANY('{}')` would
    // be a pointless round-trip on a hot path.
    const tx = makeTx();

    await lockAssetsForArchiveGuard(tx, [], "org-1");

    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
