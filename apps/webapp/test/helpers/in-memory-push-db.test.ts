/**
 * Tests for the in-memory Prisma stand-in the push tests run on.
 *
 * The fake is only worth trusting if a query it cannot evaluate faithfully
 * fails the test instead of quietly matching nothing, so these cases pin that
 * it throws on what it does not model and evaluates what it does.
 *
 * @see {@link file://./in-memory-push-db.ts}
 */
import {
  pushDb,
  resetPushStore,
  seedOrganization,
  seedPushToken,
} from "./in-memory-push-db";

// @vitest-environment node

beforeEach(() => {
  resetPushStore();
  seedPushToken({
    token: "ExponentPushToken[old]",
    userId: "user-1",
    lastSeenAt: new Date("2026-10-01T00:00:00.000Z"),
  });
  seedPushToken({
    token: "ExponentPushToken[new]",
    userId: "user-2",
    lastSeenAt: new Date("2026-10-20T00:00:00.000Z"),
  });
});

describe("in-memory push db", () => {
  it("evaluates `in` and `lt` filters", async () => {
    const rows = await pushDb.pushToken.findMany({
      where: {
        userId: { in: ["user-1", "user-2"] },
        lastSeenAt: { lt: new Date("2026-10-10T00:00:00.000Z") },
      },
      select: { token: true },
    });

    expect(rows).toEqual([{ token: "ExponentPushToken[old]" }]);
  });

  it("orders and skips rows the way the device cap reads them", async () => {
    const rows = await pushDb.pushToken.findMany({
      where: { userId: { in: ["user-1", "user-2"] } },
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      skip: 1,
      select: { token: true },
    });

    expect(rows).toEqual([{ token: "ExponentPushToken[old]" }]);
  });

  it("throws on a filter value of undefined, which Prisma would drop", () => {
    expect(() =>
      pushDb.pushToken.findMany({ where: { userId: undefined } })
    ).toThrow("where.userId is undefined");
  });

  it.each([
    { where: { userId: { not: "user-1" } }, problem: "unsupported filter" },
    { where: { token: { startsWith: "Expo" } }, problem: "unsupported filter" },
    { where: { OR: [{ userId: "user-1" }] }, problem: "unknown column OR" },
    { where: { user: { id: "user-1" } }, problem: "unknown column user" },
  ])("throws on $where", ({ where, problem }) => {
    expect(() => pushDb.pushToken.findMany({ where })).toThrow(problem);
  });

  it("throws on a nested select", () => {
    expect(() =>
      pushDb.pushToken.findMany({ select: { user: { select: { id: true } } } })
    ).toThrow("nested select");
  });

  it("throws on an argument it does not model", () => {
    expect(() =>
      pushDb.pushToken.findMany({ include: { user: true } } as never)
    ).toThrow("unsupported argument include");
  });

  it("throws when the tier lookup selects anything but the push tier shape", () => {
    seedOrganization({ id: "org-1", userId: "owner-1" }, "tier_1");

    expect(() =>
      pushDb.organization.findMany({
        where: { id: { in: ["org-1"] } },
        select: { id: true, userId: true },
      })
    ).toThrow("unexpected select");
  });
});
