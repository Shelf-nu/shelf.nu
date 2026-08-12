import { OrganizationRoles } from "@prisma/client";
import { describe, expect, it, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { releaseCustody } from "./service.server";

// why: isolate the custody service from the database so we can exercise the
// SELF_SERVICE self-restriction guard without a real DB.
vitest.mock("~/database/db.server", () => ({
  db: {
    $transaction: vitest
      .fn()
      .mockImplementation((callback: (tx: unknown) => unknown) => callback(db)),
    custody: {
      findFirst: vitest.fn().mockResolvedValue(null),
      deleteMany: vitest.fn().mockResolvedValue({ count: 1 }),
    },
    asset: {
      update: vitest.fn().mockResolvedValue({}),
      // why: release now splits into custody.deleteMany -> guarded
      // asset.updateMany -> re-read, so the status write can carry a
      // `status: { not: CHECKED_OUT }` predicate that a nested `update`
      // cannot express.
      updateMany: vitest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vitest.fn().mockResolvedValue({ id: "asset-1", custody: [] }),
    },
  },
}));

// why: avoid emitting real activity events during the test.
vitest.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vitest.fn().mockResolvedValue(undefined),
}));

describe("releaseCustody SELF_SERVICE self-restriction", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
  });

  it("blocks a SELF_SERVICE user from releasing someone else's custody", async () => {
    // The asset's current custodian is a DIFFERENT user than the caller.
    (db.custody.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue({
      custodian: { userId: "other-user" },
    });

    await expect(
      releaseCustody({
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "me",
        role: OrganizationRoles.SELF_SERVICE,
      })
    ).rejects.toThrow(
      "Self service user can only release custody of assets assigned to their user"
    );

    // The custody must never be released.
    expect(db.asset.update).not.toHaveBeenCalled();
  });
});

/**
 * Releasing custody must never advertise a checked-out asset as free.
 *
 * This is the more dangerous half of the `CHECKED_OUT > IN_CUSTODY > AVAILABLE`
 * precedence: an asset physically out on an ONGOING booking returning to every
 * picker, index and availability sum as `AVAILABLE`. Assets already in that
 * state predate the assign-side guard, so the 400 on assignment does not cover
 * them.
 *
 * @see {@link file://./../asset/custody-status.server.ts}
 */
describe("releaseCustody status write", () => {
  beforeEach(() => {
    vitest.clearAllMocks();
    (db.custody.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      null
    );
  });

  it("refuses to clear CHECKED_OUT when returning the asset to AVAILABLE", async () => {
    expect.assertions(2);

    await releaseCustody({
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "me",
      role: OrganizationRoles.ADMIN,
    });

    const call = (db.asset.updateMany as ReturnType<typeof vitest.fn>).mock
      .calls[0]?.[0];

    // The guard is on the WHERE so it evaluates at write time inside the
    // transaction. A read-then-write would leave a TOCTOU gap against a
    // checkout committing in between.
    expect(call?.where?.status).toEqual({ not: "CHECKED_OUT" });
    expect(call?.data).toEqual({ status: "AVAILABLE" });
  });

  it("deletes the custody rows regardless, so a checked-out asset still loses its custodian", async () => {
    expect.assertions(1);

    await releaseCustody({
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "me",
      role: OrganizationRoles.ADMIN,
    });

    // Custody and checkout are independent commitments. Refusing the status
    // write must not refuse the release itself.
    expect(db.custody.deleteMany).toHaveBeenCalledWith({
      where: { assetId: "asset-1" },
    });
  });
});
