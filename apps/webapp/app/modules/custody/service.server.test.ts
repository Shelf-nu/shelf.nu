import type { Prisma } from "@prisma/client";
import { AssetType, OrganizationRoles } from "@prisma/client";
import { describe, expect, it, vitest, beforeEach } from "vitest";
import { db } from "~/database/db.server";
import { ShelfError } from "~/utils/error";
import { assertNotKitMembers, releaseCustody } from "./service.server";

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
    // why: `assertNotKitMembers` reads kit membership through this delegate;
    // its suite answers it from a small in-memory table.
    assetKit: {
      findMany: vitest.fn().mockResolvedValue([]),
    },
    // why: `assertNotKitMembers` locks the asset rows with a raw
    // `SELECT ... FOR UPDATE` before reading membership.
    $queryRaw: vitest.fn().mockResolvedValue([]),
    asset: {
      update: vitest.fn().mockResolvedValue({}),
      // why: release now splits into custody.deleteMany -> guarded
      // asset.updateMany -> re-read, so the status write can carry a
      // `status: { not: CHECKED_OUT }` predicate that a nested `update`
      // cannot express.
      updateMany: vitest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: vitest
        .fn()
        .mockResolvedValue({ id: "asset-1", custody: [] }),
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
    // `clearAllMocks` clears calls but NOT implementations, so re-establish the
    // not-checked-out default here — otherwise a test that models a shortfall
    // would leak `{ count: 0 }` into every test after it.
    vitest.clearAllMocks();
    (db.custody.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      null
    );
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 1,
    });
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
    expect.assertions(2);

    // Model the asset this test is named for: `{ count: 0 }` is what the
    // guarded write returns when the row was filtered out for being
    // CHECKED_OUT. With the default `{ count: 1 }` this test would exercise
    // the not-checked-out path and its name would be a lie.
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 0,
    });

    await expect(
      releaseCustody({
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "me",
        role: OrganizationRoles.ADMIN,
      })
    ).resolves.toBeDefined();

    // Custody and checkout are independent commitments. Refusing the status
    // write must not refuse the release itself — otherwise a checked-out asset
    // is stuck with a custodian it no longer has.
    //
    // The `asset: { organizationId }` filter is part of the contract, not
    // incidental: `assetId` is request input, so this delete proves org
    // ownership rather than relying on a later read to roll it back.
    expect(db.custody.deleteMany).toHaveBeenCalledWith({
      where: {
        assetId: "asset-1",
        asset: { organizationId: "org-1" },
        kitCustodyId: null,
      },
    });
  });
});

describe("releaseCustody kit-derived custody guard", () => {
  beforeEach(() => {
    // Same reason as the suite above: `clearAllMocks` clears calls but NOT
    // implementations, so both defaults have to be re-established here or a
    // `{ count: 0 }` left behind by the shortfall test models a CHECKED_OUT
    // asset in every test below it. `mockResolvedValue` (not `...Once`) so no
    // queued value can survive into the next test and answer its guard read.
    vitest.clearAllMocks();
    (db.custody.findFirst as ReturnType<typeof vitest.fn>).mockResolvedValue(
      null
    );
    (db.asset.updateMany as ReturnType<typeof vitest.fn>).mockResolvedValue({
      count: 1,
    });
  });

  it("aborts before the status write when a kit holds custody of the asset", async () => {
    // why the name is about ORDERING, not rollback: `db.$transaction` is mocked
    // as `(cb) => cb(db)`, so there is no transaction here and nothing to roll
    // back. What this can prove — and what actually matters — is that the guard
    // fires before anything marks the asset AVAILABLE. The rollback itself is
    // Prisma's, guaranteed by the throw escaping `$transaction` in production.
    vitest
      .mocked(db.custody.findFirst)
      .mockResolvedValue({ assetId: "asset-1" } as never);

    await expect(
      releaseCustody({
        assetId: "asset-1",
        organizationId: "org-1",
        userId: "user-1",
        role: OrganizationRoles.ADMIN,
      })
    ).rejects.toThrow(/release the kit/i);

    // The delete may run first, but only ever against operator rows...
    expect(db.custody.deleteMany).toHaveBeenCalledWith({
      where: {
        assetId: "asset-1",
        asset: { organizationId: "org-1" },
        kitCustodyId: null,
      },
    });
    // ...and the guard aborts before any status write can mark the asset
    // AVAILABLE while the kit still names a custodian.
    expect(db.asset.updateMany).not.toHaveBeenCalled();
  });

  it("releases operator-assigned custody untouched by any kit", async () => {
    // why: the guard reads through the same mocked findFirst; null models an
    // asset whose custody rows are all operator-assigned. The beforeEach
    // already sets this — restated so the case under test is readable here.
    vitest.mocked(db.custody.findFirst).mockResolvedValue(null as never);

    await releaseCustody({
      assetId: "asset-1",
      organizationId: "org-1",
      userId: "user-1",
      role: OrganizationRoles.ADMIN,
    });

    expect(db.custody.deleteMany).toHaveBeenCalledWith({
      where: {
        assetId: "asset-1",
        asset: { organizationId: "org-1" },
        kitCustodyId: null,
      },
    });
    // ...and the release actually completes. Without this the test would still
    // pass if the guard rejected the asset, since the delete above runs first.
    expect(db.asset.updateMany).toHaveBeenCalled();
  });
});

/**
 * An individually tracked kit member cannot be put into custody on its own.
 *
 * The fake below answers `assetKit.findFirst` by applying the query's own
 * filters to a small table, so these tests fail if the guard stops filtering by
 * workspace or by asset type, not only if it stops throwing.
 */
describe("assertNotKitMembers", () => {
  /** One kit membership row, flattened. */
  type Membership = {
    assetId: string;
    assetTitle: string;
    assetType: AssetType;
    organizationId: string;
    kitId: string;
    kitName: string;
  };

  const MEMBERSHIPS: Membership[] = [
    {
      assetId: "tripod",
      assetTitle: "Tripod",
      assetType: AssetType.INDIVIDUAL,
      organizationId: "org-1",
      kitId: "kit-camera",
      kitName: "Camera Kit",
    },
    {
      assetId: "gimbal",
      assetTitle: "Gimbal",
      assetType: AssetType.INDIVIDUAL,
      organizationId: "org-1",
      kitId: "kit-video",
      kitName: "Video Kit",
    },
    {
      assetId: "batteries",
      assetTitle: "Batteries",
      assetType: AssetType.QUANTITY_TRACKED,
      organizationId: "org-1",
      kitId: "kit-camera",
      kitName: "Camera Kit",
    },
    {
      assetId: "other-workspace-lens",
      assetTitle: "Lens",
      assetType: AssetType.INDIVIDUAL,
      organizationId: "org-2",
      kitId: "kit-elsewhere",
      kitName: "Elsewhere Kit",
    },
  ];

  /** The `where` the guard sends, as far as this fake understands it. */
  type MembershipWhere = {
    assetId?: { in?: string[] };
    organizationId?: string;
    asset?: { type?: AssetType };
  };

  beforeEach(() => {
    vitest.clearAllMocks();
    vitest.mocked(db.assetKit.findMany).mockImplementation((({
      where,
      orderBy,
    }: {
      where: MembershipWhere;
      orderBy?: { asset?: { title?: "asc" } };
    }) =>
      Promise.resolve(
        MEMBERSHIPS.filter(
          (m) =>
            (where.assetId?.in ?? []).includes(m.assetId) &&
            m.organizationId === where.organizationId &&
            (where.asset?.type === undefined ||
              m.assetType === where.asset.type)
        )
          .sort((x, y) =>
            orderBy?.asset?.title === "asc"
              ? x.assetTitle.localeCompare(y.assetTitle)
              : 0
          )
          .map((row) => ({
          asset: { id: row.assetId, title: row.assetTitle },
          kit: { id: row.kitId, name: row.kitName },
        }))
      )) as never);
  });

  it("refuses an individually tracked kit member, naming the asset and its kit", async () => {
    const caught = await assertNotKitMembers(db, ["tripod"], "org-1").catch(
      (e: unknown) => e
    );

    expect(caught).toBeInstanceOf(ShelfError);
    expect(caught).toMatchObject({
      status: 400,
      title: "Asset is part of a kit",
      message:
        '"Tripod" is part of kit "Camera Kit". Assign custody to the kit, or remove the asset from the kit first.',
      // An expected refusal, not a fault worth reporting.
      shouldBeCaptured: false,
    });
  });

  it("refuses the whole list when any one asset is a kit member", async () => {
    await expect(
      assertNotKitMembers(db, ["drill", "tripod"], "org-1")
    ).rejects.toThrow('"Tripod" is part of kit "Camera Kit"');
  });

  it("allows a quantity-tracked kit member, whose free units can still be assigned", async () => {
    await expect(
      assertNotKitMembers(db, ["batteries"], "org-1")
    ).resolves.toBeUndefined();
  });

  it("allows an asset that is in no kit", async () => {
    await expect(
      assertNotKitMembers(db, ["drill"], "org-1")
    ).resolves.toBeUndefined();
  });

  it("ignores a kit membership in another workspace", async () => {
    // The ids are request input. Another workspace's membership must neither
    // refuse this request nor be named in its message.
    await expect(
      assertNotKitMembers(db, ["other-workspace-lens"], "org-1")
    ).resolves.toBeUndefined();
  });

  it("counts every kit member in the request and names them", async () => {
    // A "select all" can hold many members the menu could not flag. Naming
    // only the first would send the operator through one retry per member.
    await expect(
      assertNotKitMembers(db, ["tripod", "gimbal", "drill"], "org-1")
    ).rejects.toThrow(
      '2 of the selected assets are part of a kit: "Gimbal" and "Tripod".'
    );
  });

  it("reads nothing for an empty list", async () => {
    await assertNotKitMembers(db, [], "org-1");

    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.assetKit.findMany).not.toHaveBeenCalled();
  });

  it("locks the asset rows in id order, in the caller's workspace, before reading membership", async () => {
    // why this is asserted on the query and its order: the lock is what makes a
    // concurrent kit insert wait (its foreign-key check takes FOR KEY SHARE on
    // the asset), and it only helps if it is taken before the membership read.
    await assertNotKitMembers(db, ["drill", "saw"], "org-1");

    const lock = vitest.mocked(db.$queryRaw).mock;
    expect(lock.calls).toHaveLength(1);
    const query = lock.calls[0][0] as unknown as Prisma.Sql;
    const sql = query.text.replace(/\s+/g, " ");
    expect(sql).toContain('FROM "Asset"');
    expect(sql).toContain('ORDER BY "id" FOR UPDATE');
    // One array parameter, not one per id: a "select all" must stay under
    // Postgres's bind-parameter limit.
    expect(sql).toContain('"id" = ANY($1::text[])');
    expect(query.values).toEqual([["drill", "saw"], "org-1"]);
    expect(lock.invocationCallOrder[0]).toBeLessThan(
      vitest.mocked(db.assetKit.findMany).mock.invocationCallOrder[0]
    );
  });
});
