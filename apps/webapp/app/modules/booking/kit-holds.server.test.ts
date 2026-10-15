// @vitest-environment node
/**
 * Tests for `assertKitsHaveActiveAssets`: a kit with no active member (only
 * archived ones, or none) cannot be put into custody or booked.
 *
 * @see {@link file://./kit-holds.server.ts}
 */
import { ShelfError } from "~/utils/error";
import { assertKitsHaveActiveAssets } from "./kit-holds.server";

// why: importing the module pulls in the Prisma client; every call here passes
// its own fake client, so a hollow mock keeps the suite DB-free.
vitest.mock("~/database/db.server", () => ({ db: {} }));

/** A client whose kit table answers the guard's query with `kits`. */
function clientWith(
  kits: { id: string; name: string; _count: { assetKits: number } }[]
) {
  return { kit: { findMany: vitest.fn().mockResolvedValue(kits) } } as never;
}

describe("assertKitsHaveActiveAssets", () => {
  it("asks only for kits with no member whose asset is active", async () => {
    const client = clientWith([]);

    await expect(
      assertKitsHaveActiveAssets(client, {
        kitIds: ["k1", "k1", "k2"],
        organizationId: "org-1",
        action: "custody",
      })
    ).resolves.toBeUndefined();

    expect(
      (client as { kit: { findMany: ReturnType<typeof vitest.fn> } }).kit
        .findMany
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ["k1", "k2"] },
          organizationId: "org-1",
          assetKits: { none: { asset: { archivedAt: null } } },
        },
      })
    );
  });

  it("refuses a kit whose members are all archived, by name", async () => {
    const err = await assertKitsHaveActiveAssets(
      clientWith([{ id: "k1", name: "Shoot Kit", _count: { assetKits: 2 } }]),
      { kitIds: ["k1"], organizationId: "org-1", action: "custody" }
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.message).toBe(
      'Kit "Shoot Kit" holds only archived assets, so there is nothing to put into custody. Add an active asset to it, or have an admin reinstate one.'
    );
    expect(err.additionalData).toEqual({ kitIdsWithoutActiveAssets: ["k1"] });
  });

  it("says an empty kit has no assets", async () => {
    const err = await assertKitsHaveActiveAssets(
      clientWith([{ id: "k1", name: "Bag", _count: { assetKits: 0 } }]),
      { kitIds: ["k1"], organizationId: "org-1", action: "booking" }
    ).catch((e) => e);

    expect(err.message).toBe(
      'Kit "Bag" has no assets, so there is nothing to book. Add assets to it first.'
    );
  });

  it("is a no-op for no kits", async () => {
    const client = clientWith([]);
    await assertKitsHaveActiveAssets(client, {
      kitIds: [],
      organizationId: "org-1",
      action: "booking",
    });
    expect(
      (client as { kit: { findMany: ReturnType<typeof vitest.fn> } }).kit
        .findMany
    ).not.toHaveBeenCalled();
  });
});
