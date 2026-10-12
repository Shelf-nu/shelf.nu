import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "~/database/db.server";
import { findMobileArchivedRefusal } from "~/modules/api/mobile-archived.server";
import { assertAssetsAreNotArchived } from "~/utils/org-validation.server";

// why: the module reads the database, and a real Prisma client tries to
// connect at import. `asset.findMany` finds the archived subset; `asset.count`
// backs the shared `assertAssetsAreNotArchived` guard, which runs for real so
// the refusal is compared against its actual wording.
vi.mock("~/database/db.server", () => ({
  db: {
    asset: { findMany: vi.fn(), count: vi.fn() },
  },
}));

const findManyMock = db.asset.findMany as unknown as Mock;
const countMock = db.asset.count as unknown as Mock;

/** The archived assets the database holds, by id and title. */
function archivedInDb(rows: { id: string; title: string }[]) {
  findManyMock.mockResolvedValue(rows);
  countMock.mockResolvedValue(rows.length);
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
      })
    ).resolves.toBeNull();
  });

  it("does not read the database for an empty list", async () => {
    await expect(
      findMobileArchivedRefusal({ assetIds: [], organizationId: "org-1" })
    ).resolves.toBeNull();
    expect(findManyMock).not.toHaveBeenCalled();
  });

  it("names only the archived ids, once each, in request order", async () => {
    archivedInDb([
      { id: "asset-3", title: "Tripod" },
      { id: "asset-1", title: "Old camera" },
    ]);

    const refusal = await findMobileArchivedRefusal({
      assetIds: ["asset-1", "asset-2", "asset-3", "asset-1"],
      organizationId: "org-1",
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
      select: { id: true, title: true },
    });
  });

  it("words the refusal as the shared guard words a scanned list, in one read", async () => {
    archivedInDb([{ id: "asset-1", title: "Old camera" }]);

    const refusal = await findMobileArchivedRefusal({
      assetIds: ["asset-1"],
      organizationId: "org-1",
    });
    // One read: the titles come with the ids, nothing re-runs the guard.
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(countMock).not.toHaveBeenCalled();

    // Whatever the guard says for a scanned list is what the phone is sent.
    const guardMessage = await assertAssetsAreNotArchived({
      assetIds: ["asset-1"],
      organizationId: "org-1",
      fix: "remove-from-list",
    }).then(
      () => null,
      (cause: Error) => cause.message
    );
    expect(guardMessage).toContain("Old camera");
    expect(refusal?.message).toBe(guardMessage);
  });
});
