import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { findMobileArchivedRefusal } from "~/modules/api/mobile-archived.server";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";

// why: the module reads the database, and a real Prisma client tries to
// connect at import. `asset.findMany` finds the archived subset; `asset.count`
// backs the shared `assertAssetsAreNotArchived` guard, which runs for real so
// the refusal carries its actual wording.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn(), count: vi.fn() },
  },
}));

const findManyMock = db.asset.findMany as unknown as Mock;
const countMock = db.asset.count as unknown as Mock;

/** The archived subset the database holds, keyed by id. */
function archivedInDb(ids: string[]) {
  findManyMock.mockResolvedValue(ids.map((id) => ({ id })));
  countMock.mockResolvedValue(ids.length);
}

describe("findMobileArchivedRefusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    archivedInDb([]);
  });

  it("answers nothing when no requested asset is archived", async () => {
    await expect(
      findMobileArchivedRefusal({
        assetIds: ["asset-1", "asset-2"],
        organizationId: "org-1",
        purpose: "change",
      })
    ).resolves.toBeNull();
  });

  it("does not read the database for an empty list", async () => {
    await expect(
      findMobileArchivedRefusal({
        assetIds: [],
        organizationId: "org-1",
        purpose: "change",
      })
    ).resolves.toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("names only the archived ids, once each, in request order", async () => {
    archivedInDb(["asset-3", "asset-1"]);

    const refusal = await findMobileArchivedRefusal({
      assetIds: ["asset-1", "asset-2", "asset-3", "asset-1"],
      organizationId: "org-1",
      purpose: "change",
    });

    expect(refusal?.reason).toBe("archived");
    expect(refusal?.archivedAssetIds).toEqual(["asset-1", "asset-3"]);
    // Org-scoped, deduplicated, and limited to archived rows.
    expect(findManyMock).toHaveBeenCalledWith({
      where: {
        id: { in: ["asset-1", "asset-2", "asset-3"] },
        organizationId: "org-1",
        archivedAt: { not: null },
      },
      select: { id: true },
    });
  });

  it("words a change refusal exactly as the shared archived guard does", async () => {
    archivedInDb(["asset-1"]);

    const refusal = await findMobileArchivedRefusal({
      assetIds: ["asset-1"],
      organizationId: "org-1",
      purpose: "change",
    });
    // One read: the wording is borrowed, not re-derived by running the guard.
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(countMock).not.toHaveBeenCalled();

    // Whatever the guard says for these assets is what the phone is sent.
    const guardMessage = await assertAssetsAreNotArchived({
      assetIds: ["asset-1"],
      organizationId: "org-1",
    }).then(
      () => null,
      (cause: Error) => cause.message
    );
    expect(guardMessage).toBeTruthy();
    expect(refusal?.message).toBe(guardMessage);
  });

  it("words a booking refusal as the booking service's scan refusal", async () => {
    archivedInDb(["asset-1"]);

    const refusal = await findMobileArchivedRefusal({
      assetIds: ["asset-1"],
      organizationId: "org-1",
      purpose: "booking",
    });

    expect(refusal?.message).toBe(
      "Some scanned assets are archived and can't be added to a booking. Reinstate them first."
    );
  });
});
