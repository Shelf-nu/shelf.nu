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
  assertTagsBelongToOrg,
  assertTeamMemberBelongsToOrg,
  assertCategoryBelongsToOrg,
  assertLocationBelongsToOrg,
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
    location: { findFirst: vitest.fn().mockResolvedValue(null) },
    userOrganization: { findFirst: vitest.fn().mockResolvedValue(null) },
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

describe("single-entity guards reject foreign/missing with 404", () => {
  it("assertTeamMemberBelongsToOrg throws 404 when not found in org", async () => {
    const tx = txWith({
      teamMember: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertTeamMemberBelongsToOrg(
      { teamMemberId: "tm-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(404);
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

  it("assertCategoryBelongsToOrg throws 404 when foreign/missing", async () => {
    const tx = txWith({
      category: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertCategoryBelongsToOrg(
      { categoryId: "c-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(404);
  });

  it("assertLocationBelongsToOrg throws 404 when foreign/missing", async () => {
    const tx = txWith({
      location: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertLocationBelongsToOrg(
      { locationId: "l-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(404);
  });

  it("assertLocationBelongsToOrg resolves when the location is in the org", async () => {
    const tx = txWith({
      location: { findFirst: vitest.fn().mockResolvedValue({ id: "l-1" }) },
    });
    await expect(
      assertLocationBelongsToOrg({ locationId: "l-1", organizationId: ORG }, tx)
    ).resolves.toBeUndefined();
  });
});

describe("assertUserBelongsToOrg", () => {
  it("throws 404 when the user is not a member of the org (foreign custodian user)", async () => {
    const tx = txWith({
      userOrganization: { findFirst: vitest.fn().mockResolvedValue(null) },
    });
    const err = await assertUserBelongsToOrg(
      { userId: "u-foreign", organizationId: ORG },
      tx
    ).catch((e) => e);

    expect(err).toBeInstanceOf(ShelfError);
    expect(err.status).toBe(404);
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
