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
    },
    asset: {
      update: vitest.fn().mockResolvedValue({}),
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
