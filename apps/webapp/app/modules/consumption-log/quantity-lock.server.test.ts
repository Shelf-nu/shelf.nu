/**
 * Unit tests for the org-scoped asset row locks: `lockAssetForQuantityUpdate`
 * (one asset) and `lockEveryAssetForQuantityUpdate` (many, one statement).
 *
 * The lock runs a raw `SELECT ... FOR UPDATE`, so it can't execute against a
 * mocked transaction client. Instead we stub `tx.$queryRaw` and assert on the
 * shape of the tagged-template call: both the asset id AND the caller's
 * organization id must be bound into the predicate, so a foreign-org id can
 * never match a row (and therefore never acquires a lock — it 404s first).
 *
 * @see {@link file://./quantity-lock.server.ts}
 */
import { describe, expect, it, vitest } from "vitest";

import {
  lockAssetForQuantityUpdate,
  lockEveryAssetForQuantityUpdate,
} from "./quantity-lock.server";

describe("lockAssetForQuantityUpdate — org-scoped FOR UPDATE lock", () => {
  it("binds BOTH the asset id and the organization id into the FOR UPDATE predicate", async () => {
    const queryRaw = vitest
      .fn()
      .mockResolvedValue([{ id: "asset-1", organizationId: "org-1" }]);
    // why: the raw `SELECT ... FOR UPDATE` can't run against a mocked tx — stub
    // `$queryRaw` and inspect the tagged-template arguments it receives.
    const tx = { $queryRaw: queryRaw };

    await lockAssetForQuantityUpdate(tx, "asset-1", "org-1");

    // A tagged template call is `(stringsArray, ...interpolatedValues)`. Both
    // the asset id and the org id must be bound values, and the literal SQL
    // must scope on `"organizationId"` — otherwise the lock is a cross-org
    // oracle (an attacker in Org A could lock Org B's row before any org check).
    const [strings, ...values] = queryRaw.mock.calls[0];
    expect(strings.join("?")).toContain('"organizationId"');
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(values).toEqual(["asset-1", "org-1"]);
  });

  it("throws 404 (and takes NO lock) when the org-scoped query matches nothing", async () => {
    // A foreign-org id — or a deleted asset — matches zero rows under the
    // org-scoped predicate, so there is no row to lock. The helper 404s.
    const queryRaw = vitest.fn().mockResolvedValue([]);
    const tx = { $queryRaw: queryRaw };

    await expect(
      lockAssetForQuantityUpdate(tx, "foreign-asset", "org-1")
    ).rejects.toMatchObject({ status: 404, message: "Asset not found" });
  });

  it("returns the locked row for a same-org id", async () => {
    const row = { id: "asset-1", organizationId: "org-1", quantity: 10 };
    const queryRaw = vitest.fn().mockResolvedValue([row]);
    const tx = { $queryRaw: queryRaw };

    await expect(
      lockAssetForQuantityUpdate(tx, "asset-1", "org-1")
    ).resolves.toEqual(row);
  });
});

describe("lockEveryAssetForQuantityUpdate", () => {
  it("locks N assets with one org-scoped FOR UPDATE statement", async () => {
    // why: the raw `SELECT ... FOR UPDATE` can't run against a mocked tx, so
    // `$queryRaw` stands in and returns every requested row.
    const queryRaw = vitest
      .fn()
      .mockResolvedValue([
        { id: "asset-a" },
        { id: "asset-b" },
        { id: "asset-c" },
      ]);
    const tx = { $queryRaw: queryRaw };

    await lockEveryAssetForQuantityUpdate(
      tx,
      ["asset-c", "asset-a", "asset-b", "asset-a"],
      "org-1"
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings] = queryRaw.mock.calls[0];
    expect(strings.join("?")).toContain('"organizationId"');
    expect(strings.join("?")).toContain("FOR UPDATE");
  });

  it("throws 404 when one of the ids matches no row in the caller's org", async () => {
    // why: stands in for the raw lock query; "foreign-asset" is absent from
    // the result, as a foreign-org or deleted id would be.
    const queryRaw = vitest.fn().mockResolvedValue([{ id: "asset-a" }]);
    const tx = { $queryRaw: queryRaw };

    await expect(
      lockEveryAssetForQuantityUpdate(tx, ["asset-a", "foreign-asset"], "org-1")
    ).rejects.toMatchObject({ status: 404, message: "Asset not found" });
  });

  it("issues no query for an empty id list", async () => {
    // why: observes that no lock statement is sent.
    const queryRaw = vitest.fn();
    const tx = { $queryRaw: queryRaw };

    await lockEveryAssetForQuantityUpdate(tx, [], "org-1");

    expect(queryRaw).not.toHaveBeenCalled();
  });
});
