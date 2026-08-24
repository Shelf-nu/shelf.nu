/**
 * Add-on trial claim.
 *
 * One free trial per workspace per add-on, and starting one creates a real
 * Stripe subscription — so the decision has to be taken exactly once. These
 * tests pin the shape that makes that true: a single conditional `UPDATE`
 * whose affected-row count IS the verdict, never a read followed by a write.
 *
 * @see {@link file://./addon-trial-claim.server.ts}
 */

import { describe, expect, it, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";

import { claimAddonTrial, releaseAddonTrial } from "./addon-trial-claim.server";

// why: the claim is a single database statement, and what the tests care about
// is the statement it issues and how it reads the result. Stubbing `updateMany`
// lets each case state an outcome ("this caller won", "someone else did")
// directly.
vitest.mock("~/database/db.server", () => ({
  db: { organization: { updateMany: vitest.fn() } },
}));

const updateManyMock = db.organization.updateMany as ReturnType<
  typeof vitest.fn
>;

const ORG_ID = "org-1";

beforeEach(() => {
  vitest.clearAllMocks();
});

describe("claimAddonTrial", () => {
  it("claims the trial with one conditional statement", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    await expect(
      claimAddonTrial({ organizationId: ORG_ID, addon: "audits" })
    ).resolves.toBe(true);

    // The condition has to live in the predicate. Reading the flag first and
    // writing it afterwards is the race — two callers both read `false`, and
    // both go on to create a subscription.
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: ORG_ID, usedAuditTrial: false },
      data: { usedAuditTrial: true },
    });
    expect(updateManyMock).toHaveBeenCalledTimes(1);
  });

  it("reports a lost claim when the row no longer matches", async () => {
    // Zero rows updated is how the database says another caller got there
    // first — either an earlier request or one racing this exact call.
    updateManyMock.mockResolvedValue({ count: 0 });

    await expect(
      claimAddonTrial({ organizationId: ORG_ID, addon: "audits" })
    ).resolves.toBe(false);
  });

  it("targets each add-on's own column", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    await claimAddonTrial({ organizationId: ORG_ID, addon: "barcodes" });

    // Spending the wrong add-on's trial would be silent: the caller still gets
    // `true` and still creates a subscription.
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: ORG_ID, usedBarcodeTrial: false },
      data: { usedBarcodeTrial: true },
    });
  });

  it("surfaces a database failure rather than reporting a claim", async () => {
    // Returning `false` here would read as "already used" and quietly deny a
    // workspace its trial; returning `true` would hand out a subscription on
    // an unproven claim.
    updateManyMock.mockRejectedValue(new Error("connection reset"));

    await expect(
      claimAddonTrial({ organizationId: ORG_ID, addon: "audits" })
    ).rejects.toThrow(ShelfError);
  });
});

describe("releaseAddonTrial", () => {
  it("returns the trial so a failed attempt can be retried", async () => {
    updateManyMock.mockResolvedValue({ count: 1 });

    await releaseAddonTrial({ organizationId: ORG_ID, addon: "barcodes" });

    // Guarded on the flag being set, so a release can only undo a claim that
    // is actually outstanding.
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: ORG_ID, usedBarcodeTrial: true },
      data: { usedBarcodeTrial: false },
    });
  });

  it("surfaces a database failure", async () => {
    updateManyMock.mockRejectedValue(new Error("connection reset"));

    await expect(
      releaseAddonTrial({ organizationId: ORG_ID, addon: "audits" })
    ).rejects.toThrow(ShelfError);
  });
});
