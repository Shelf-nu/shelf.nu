// @vitest-environment node
/**
 * Unit tests for the shared cross-org ownership guards.
 *
 * These guards are the central IDOR chokepoint — every create/update/bulk path
 * that connects request-supplied IDs relies on them. The tests assert the
 * security-critical behaviors: org-scoped query shape, mismatch rejection,
 * input deduping, empty no-op, and the exact ShelfError status/title.
 *
 * The guards accept an optional Prisma client (tx); we pass a fake client so
 * no database is required and the query args can be asserted directly.
 *
 * @see {@link file://./org-validation.server.ts}
 */
import { ShelfError } from "./error";
import {
  assertAssetsBelongToOrg,
  assertAssetKitsBelongToOrg,
  assertAssetModelBelongsToOrg,
  assertCategoryBelongsToOrg,
  assertCustomFieldsBelongToOrg,
  assertKitsBelongToOrg,
  assertLocationBelongsToOrg,
  assertLocationsBelongToOrg,
  assertTagsBelongToOrg,
  assertTagsAssignableToAssets,
  assertTeamMemberBelongsToOrg,
  assertUserBelongsToOrg,
} from "./org-validation.server";

// why: importing the module pulls in ~/database/db.server (Prisma client
// init). The guards never touch it here because every call passes an explicit
// tx, so a hollow mock is enough and keeps the suite DB-free.
vitest.mock("~/database/db.server", () => ({ db: {} }));

const ORG = "org-1";

function txWith(overrides: Record<string, any>) {
  return {
    asset: { findMany: vitest.fn().mockResolvedValue([]) },
    tag: { findMany: vitest.fn().mockResolvedValue([]) },
    teamMember: { findFirst: vitest.fn().mockResolvedValue(null) },
    category: { findFirst: vitest.fn().mockResolvedValue(null) },
    location: {
      findFirst: vitest.fn().mockResolvedValue(null),
      findMany: vitest.fn().mockResolvedValue([]),
    },
    kit: { findMany: vitest.fn().mockResolvedValue([]) },
    customField: { findMany: vitest.fn().mockResolvedValue([]) },
    userOrganization: { findFirst: vitest.fn().mockResolvedValue(null) },
    assetKit: { findMany: vitest.fn().mockResolvedValue([]) },
    assetModel: { findFirst: vitest.fn().mockResolvedValue(null) },
    ...overrides,
  } as any;
}

describe("assertAssetsBelongToOrg", () => {
  it("is a no-op for an empty list (no query issued)", async () => {
    const tx = txWith({});
    await expect(
      assertAssetsBelongToOrg({ assetIds: [], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
    expect(tx.asset.findMany).not.toHaveBeenCalled();
  });

  it("resolves when every asset belongs to the org and scopes the query by organizationId", async () => {
    const tx = txWith({
      asset: {
        findMany: vitest.fn().mockResolvedValue([{ id: "a1" }, { id: "a2" }]),
      },
    });

    await expect(
      assertAssetsBelongToOrg(
        { assetIds: ["a1", "a2"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.asset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1", "a2"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("dedupes input so duplicate IDs don't inflate the expected count", async () => {
    // why: findMany returns unique rows; without dedupe ["a1","a1"] would
    // expect 2 rows, get 1, and falsely reject a legitimate request.
    const tx = txWith({
      asset: { findMany: vitest.fn().mockResolvedValue([{ id: "a1" }]) },
    });

    await expect(
      assertAssetsBelongToOrg(
        { assetIds: ["a1", "a1"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.asset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["a1"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("rejects with a 400 ShelfError when any ID is foreign/missing", async () => {
    // a2 belongs to another org → findMany (org-scoped) returns only a1
    const tx = txWith({
      asset: { findMany: vitest.fn().mockResolvedValue([{ id: "a1" }]) },
    });

    const err = await assertAssetsBelongToOrg(
      { assetIds: ["a1", "a2"], organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid assets");
  });
});

describe("assertAssetKitsBelongToOrg", () => {
  it("is a no-op for an empty list (no query issued)", async () => {
    const tx = txWith({});
    await expect(
      assertAssetKitsBelongToOrg({ assetKitIds: [], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
    expect(tx.assetKit.findMany).not.toHaveBeenCalled();
  });

  it("resolves when every AssetKit belongs to the org and scopes by organizationId", async () => {
    const tx = txWith({
      assetKit: {
        findMany: vitest.fn().mockResolvedValue([{ id: "ak1" }, { id: "ak2" }]),
      },
    });

    await expect(
      assertAssetKitsBelongToOrg(
        { assetKitIds: ["ak1", "ak2"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.assetKit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["ak1", "ak2"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("dedupes input so duplicate IDs don't inflate the expected count", async () => {
    const tx = txWith({
      assetKit: { findMany: vitest.fn().mockResolvedValue([{ id: "ak1" }]) },
    });

    await expect(
      assertAssetKitsBelongToOrg(
        { assetKitIds: ["ak1", "ak1"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.assetKit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["ak1"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("rejects with a 400 ShelfError when any AssetKit id is foreign/missing", async () => {
    // ak2 belongs to another org → org-scoped findMany returns only ak1
    const tx = txWith({
      assetKit: { findMany: vitest.fn().mockResolvedValue([{ id: "ak1" }]) },
    });

    const err = await assertAssetKitsBelongToOrg(
      { assetKitIds: ["ak1", "ak2"], organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
  });
});

describe("assertKitsBelongToOrg", () => {
  it("is a no-op for an empty list (no query issued)", async () => {
    const tx = txWith({});
    await expect(
      assertKitsBelongToOrg({ kitIds: [], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
    expect(tx.kit.findMany).not.toHaveBeenCalled();
  });

  it("resolves when every kit belongs to the org and scopes the query by organizationId", async () => {
    const tx = txWith({
      kit: {
        findMany: vitest.fn().mockResolvedValue([{ id: "k1" }, { id: "k2" }]),
      },
    });

    await expect(
      assertKitsBelongToOrg({ kitIds: ["k1", "k2"], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();

    expect(tx.kit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["k1", "k2"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("dedupes input so duplicate IDs don't inflate the expected count", async () => {
    const tx = txWith({
      kit: { findMany: vitest.fn().mockResolvedValue([{ id: "k1" }]) },
    });

    await expect(
      assertKitsBelongToOrg({ kitIds: ["k1", "k1"], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();

    expect(tx.kit.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["k1"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("rejects with a 400 ShelfError when any ID is foreign/missing", async () => {
    // k2 belongs to another org → the org-scoped findMany returns only k1
    const tx = txWith({
      kit: { findMany: vitest.fn().mockResolvedValue([{ id: "k1" }]) },
    });

    const err = await assertKitsBelongToOrg(
      { kitIds: ["k1", "k2"], organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid kits");
  });
});

describe("assertLocationsBelongToOrg", () => {
  it("is a no-op for an empty list (no query issued)", async () => {
    const tx = txWith({});
    await expect(
      assertLocationsBelongToOrg({ locationIds: [], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
    expect(tx.location.findMany).not.toHaveBeenCalled();
  });

  it("resolves when every location belongs to the org and scopes the query by organizationId", async () => {
    const tx = txWith({
      location: {
        findMany: vitest.fn().mockResolvedValue([{ id: "l1" }, { id: "l2" }]),
      },
    });

    await expect(
      assertLocationsBelongToOrg(
        { locationIds: ["l1", "l2"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.location.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["l1", "l2"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("dedupes input so duplicate IDs don't inflate the expected count", async () => {
    const tx = txWith({
      location: { findMany: vitest.fn().mockResolvedValue([{ id: "l1" }]) },
    });

    await expect(
      assertLocationsBelongToOrg(
        { locationIds: ["l1", "l1"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.location.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["l1"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("rejects with a 400 ShelfError when any ID is foreign/missing", async () => {
    // l2 belongs to another org → the org-scoped findMany returns only l1
    const tx = txWith({
      location: { findMany: vitest.fn().mockResolvedValue([{ id: "l1" }]) },
    });

    const err = await assertLocationsBelongToOrg(
      { locationIds: ["l1", "l2"], organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid locations");
  });
});

describe("assertTagsBelongToOrg", () => {
  it("is a no-op for an empty list", async () => {
    const tx = txWith({});
    await expect(
      assertTagsBelongToOrg({ tagIds: [], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
    expect(tx.tag.findMany).not.toHaveBeenCalled();
  });

  it("rejects with a 400 ShelfError when a tag is foreign/missing", async () => {
    const tx = txWith({
      tag: { findMany: vitest.fn().mockResolvedValue([]) },
    });

    const err = await assertTagsBelongToOrg(
      { tagIds: ["t1"], organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid tags");
  });
});

describe("assertTagsAssignableToAssets", () => {
  it("is a no-op for an empty list", async () => {
    const tx = txWith({});
    await expect(
      assertTagsAssignableToAssets({ tagIds: [], organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
    expect(tx.tag.findMany).not.toHaveBeenCalled();
  });

  it("queries org-scoped AND asset-assignable tags (useFor empty or ASSET)", async () => {
    const tx = txWith({
      tag: { findMany: vitest.fn().mockResolvedValue([{ id: "t1" }]) },
    });

    await assertTagsAssignableToAssets(
      { tagIds: ["t1"], organizationId: ORG },
      tx
    );

    // The where clause must constrain BOTH org and the asset-assignable predicate
    // so a same-org booking-only tag is rejected, not just cross-org ids.
    expect(tx.tag.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["t1"] },
          organizationId: ORG,
          OR: [{ useFor: { isEmpty: true } }, { useFor: { has: "ASSET" } }],
        }),
      })
    );
  });

  it("rejects with a 400 ShelfError when a tag is not asset-assignable/foreign", async () => {
    // findMany returns fewer rows than requested (the booking-only tag is
    // filtered out by the useFor predicate) -> mismatch -> throw.
    const tx = txWith({
      tag: { findMany: vitest.fn().mockResolvedValue([]) },
    });

    const err = await assertTagsAssignableToAssets(
      { tagIds: ["booking-only"], organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid tags");
  });
});

describe("assertCustomFieldsBelongToOrg", () => {
  it("is a no-op for an empty list (no query issued)", async () => {
    const tx = txWith({});
    await expect(
      assertCustomFieldsBelongToOrg(
        { customFieldIds: [], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();
    expect(tx.customField.findMany).not.toHaveBeenCalled();
  });

  it("resolves and scopes the query by organizationId when all belong to the org", async () => {
    // why: simulate both requested custom fields existing in the caller's org
    // so the count matches and the guard resolves.
    const tx = txWith({
      customField: {
        findMany: vitest.fn().mockResolvedValue([{ id: "cf1" }, { id: "cf2" }]),
      },
    });

    await expect(
      assertCustomFieldsBelongToOrg(
        { customFieldIds: ["cf1", "cf2"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.customField.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["cf1", "cf2"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("dedupes input so duplicate IDs don't inflate the expected count", async () => {
    // why: findMany returns unique rows; the duplicated input ["cf1","cf1"]
    // must collapse to one expected row, otherwise the guard would falsely
    // reject a legitimate request.
    const tx = txWith({
      customField: {
        findMany: vitest.fn().mockResolvedValue([{ id: "cf1" }]),
      },
    });

    await expect(
      assertCustomFieldsBelongToOrg(
        { customFieldIds: ["cf1", "cf1"], organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();

    expect(tx.customField.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["cf1"] }, organizationId: ORG },
      select: { id: true },
    });
  });

  it("rejects with a 400 ShelfError when a custom field is foreign/missing", async () => {
    // why: cf2 belongs to another org, so the org-scoped findMany returns only
    // cf1 — the count mismatch is what the guard must reject.
    const tx = txWith({
      customField: {
        findMany: vitest.fn().mockResolvedValue([{ id: "cf1" }]),
      },
    });

    const err = await assertCustomFieldsBelongToOrg(
      { customFieldIds: ["cf1", "cf2"], organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid custom fields");
  });
});

// A foreign/missing single ID is an invalid request input (not a gone
// resource), so these guards return 400 — consistent with the bulk guards
// above and the file-level contract.
describe("single-entity guards reject foreign/missing with 400", () => {
  it("assertTeamMemberBelongsToOrg throws 400 when not found in org", async () => {
    const tx = txWith({
      teamMember: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertTeamMemberBelongsToOrg(
      { teamMemberId: "tm-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(tx.teamMember.findFirst).toHaveBeenCalledWith({
      where: { id: "tm-foreign", organizationId: ORG },
      select: { id: true },
    });
  });

  it("assertTeamMemberBelongsToOrg resolves when the member is in the org", async () => {
    const tx = txWith({
      teamMember: { findFirst: vitest.fn().mockResolvedValue({ id: "tm-1" }) },
    });
    await expect(
      assertTeamMemberBelongsToOrg(
        { teamMemberId: "tm-1", organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();
  });

  it("assertCategoryBelongsToOrg throws 400 when foreign/missing", async () => {
    const tx = txWith({
      category: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertCategoryBelongsToOrg(
      { categoryId: "c-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
  });

  it("assertLocationBelongsToOrg throws 400 when foreign/missing", async () => {
    const tx = txWith({
      location: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertLocationBelongsToOrg(
      { locationId: "l-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(err.title).toBe("Invalid location");
  });

  it("assertLocationBelongsToOrg resolves when the location is in the org", async () => {
    const tx = txWith({
      location: { findFirst: vitest.fn().mockResolvedValue({ id: "l-1" }) },
    });
    await expect(
      assertLocationBelongsToOrg({ locationId: "l-1", organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
  });

  it("assertAssetModelBelongsToOrg throws 404 when foreign/missing", async () => {
    const tx = txWith({
      assetModel: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertAssetModelBelongsToOrg(
      { assetModelId: "am-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(404);
    expect(err.title).toBe("Invalid asset model");
    expect(tx.assetModel.findFirst).toHaveBeenCalledWith({
      where: { id: "am-foreign", organizationId: ORG },
      select: { id: true },
    });
  });

  it("assertAssetModelBelongsToOrg resolves when the model is in the org", async () => {
    const tx = txWith({
      assetModel: {
        findFirst: vitest.fn().mockResolvedValue({ id: "am-1" }),
      },
    });
    await expect(
      assertAssetModelBelongsToOrg(
        { assetModelId: "am-1", organizationId: ORG },
        tx
      )
    ).resolves.toBeUndefined();
  });
});

describe("assertUserBelongsToOrg", () => {
  it("throws 400 when the user is not a member of the org (foreign custodian user)", async () => {
    const tx = txWith({
      userOrganization: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertUserBelongsToOrg(
      { userId: "u-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(400);
    expect(tx.userOrganization.findFirst).toHaveBeenCalledWith({
      where: { userId: "u-foreign", organizationId: ORG },
      select: { id: true },
    });
  });

  it("resolves when the user is a member of the org", async () => {
    const tx = txWith({
      userOrganization: {
        findFirst: vitest.fn().mockResolvedValue({ id: "uo-1" }),
      },
    });
    await expect(
      assertUserBelongsToOrg({ userId: "u-1", organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
  });
});
