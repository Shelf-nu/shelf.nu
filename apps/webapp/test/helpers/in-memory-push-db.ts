/**
 * In-memory stand-in for the Prisma calls the push module makes, so tests
 * replay what Postgres would do to a handful of rows: unique tokens, filters on
 * `disabledAt` and `lastSeenAt`, owner tiers, memberships, and upserts.
 *
 * It models only the query shapes the push code emits and throws on anything
 * else: an `undefined` filter value (Prisma would drop the filter), an
 * operator other than `in` and `lt`, a column the row does not have
 * (`OR`, relation filters), a nested select, or an argument it does not
 * evaluate. A query it cannot answer faithfully fails the test instead of
 * quietly matching nothing.
 *
 * Tests share one store. Mock `~/database/db.server` with a factory that
 * imports this module and returns `{ db: pushDb }`, seed `pushStore` in
 * `beforeEach` after `resetPushStore()`, and assert on the rows afterwards.
 *
 * @see {@link file://../../app/modules/push/service.server.ts}
 * @see {@link file://../../app/modules/push/preferences.server.ts}
 * @see {@link file://../../app/utils/subscription.server.ts} filterOrganizationsWithPush
 */
import { isDeepStrictEqual } from "node:util";
import type { DevicePlatform, TierId } from "@prisma/client";

/** A `PushToken` row. */
export interface FakePushTokenRow {
  id: string;
  token: string;
  userId: string;
  platform: DevicePlatform;
  deviceName: string | null;
  appVersion: string | null;
  lastSeenAt: Date;
  disabledAt: Date | null;
}

/** A `NotificationPreference` row. */
export interface FakePreferenceRow {
  userId: string;
  pushEnabled: boolean;
  bookings: boolean;
  audits: boolean;
  stockAndReminders: boolean;
}

/** An `Organization` row, reduced to its owner. */
export interface FakeOrganizationRow {
  id: string;
  /** The owner, whose tier decides what the workspace may do. */
  userId: string;
}

/** A `UserOrganization` row: one membership. */
export interface FakeMembershipRow {
  userId: string;
  organizationId: string;
}

/** The rows every test reads and writes. */
export const pushStore = {
  /** User id to tier id. */
  userTiers: new Map<string, TierId>(),
  /**
   * Tier id to its `TierLimit.canUsePushNotifications`, as the migrations set
   * it. A tier missing here has no limit row.
   */
  tierPush: new Map<TierId, boolean>(),
  /** User id to the `canUsePushNotifications` flag of their custom tier. */
  customTierPush: new Map<string, boolean>(),
  organizations: [] as FakeOrganizationRow[],
  memberships: [] as FakeMembershipRow[],
  pushTokens: [] as FakePushTokenRow[],
  preferences: [] as FakePreferenceRow[],
};

/** Empties every table and restores the tier limits the migrations create. */
export function resetPushStore() {
  pushStore.userTiers.clear();
  pushStore.tierPush = new Map<TierId, boolean>([
    ["free", false],
    ["tier_1", true],
    ["tier_2", true],
  ]);
  pushStore.customTierPush.clear();
  pushStore.organizations = [];
  pushStore.memberships = [];
  pushStore.pushTokens = [];
  pushStore.preferences = [];
}

resetPushStore();

/** Adds a workspace and gives its owner the named tier. */
export function seedOrganization(
  organization: FakeOrganizationRow,
  ownerTier: TierId
) {
  pushStore.organizations.push({ ...organization });
  pushStore.userTiers.set(organization.userId, ownerTier);
}

/** Gives a user a `CustomTierLimit` row with the given push flag. */
export function seedCustomTierLimit(
  userId: string,
  canUsePushNotifications: boolean
) {
  pushStore.customTierPush.set(userId, canUsePushNotifications);
}

/** Makes a user a member of each workspace, in the order given. */
export function seedMemberships(userId: string, organizationIds: string[]) {
  for (const organizationId of organizationIds) {
    pushStore.memberships.push({ userId, organizationId });
  }
}

/** Adds a live push token row; overrides win. */
export function seedPushToken(
  row: Pick<FakePushTokenRow, "token" | "userId"> & Partial<FakePushTokenRow>
) {
  pushStore.pushTokens.push({
    id: `pt-${pushStore.pushTokens.length + 1}`,
    platform: "IOS",
    deviceName: null,
    appVersion: null,
    lastSeenAt: new Date("2026-01-01T00:00:00Z"),
    disabledAt: null,
    ...row,
  });
}

/** Adds a preference row; unspecified switches stay on. */
export function seedPreferences(
  row: Pick<FakePreferenceRow, "userId"> & Partial<FakePreferenceRow>
) {
  pushStore.preferences.push({
    pushEnabled: true,
    bookings: true,
    audits: true,
    stockAndReminders: true,
    ...row,
  });
}

type Where = Record<string, unknown>;
type Select = Record<string, unknown>;
type OrderBy =
  | Record<string, "asc" | "desc">
  | Array<Record<string, "asc" | "desc">>;

/** Fails the test that issued a query this fake does not model. */
function unsupported(problem: string): never {
  throw new Error(`in-memory-push-db: ${problem}`);
}

/** Throws when a call passes an argument this fake does not evaluate. */
function assertArguments(call: string, args: object, allowed: string[]) {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) {
      unsupported(`unsupported argument ${key} in ${call}`);
    }
  }
}

/** Column equality, by time for dates. */
function sameValue(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date && expected instanceof Date) {
    return actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

/** Evaluates one column filter: a plain value, `{ in: [...] }` or `{ lt }`. */
function matchesFilter(
  column: string,
  actual: unknown,
  expected: unknown
): boolean {
  if (expected === undefined) {
    unsupported(`where.${column} is undefined; Prisma would drop the filter`);
  }
  if (
    expected === null ||
    expected instanceof Date ||
    typeof expected !== "object"
  ) {
    return sameValue(actual, expected);
  }
  const operators = Object.keys(expected);
  const operand = Object.values(expected)[0];
  if (operators.length === 1 && operators[0] === "in") {
    if (!Array.isArray(operand))
      unsupported(`where.${column}.in is not a list`);
    return operand.some((value) => sameValue(actual, value));
  }
  if (operators.length === 1 && operators[0] === "lt") {
    if (!(operand instanceof Date) || !(actual instanceof Date)) {
      unsupported(`where.${column}.lt compares only dates`);
    }
    return actual.getTime() < operand.getTime();
  }
  return unsupported(
    `unsupported filter on ${column}: ${JSON.stringify(expected)}`
  );
}

/** Evaluates a Prisma `where` against one row. */
function matches(row: object, where: Where = {}): boolean {
  const record = row as Record<string, unknown>;
  return Object.entries(where).every(([column, expected]) => {
    if (!(column in record)) unsupported(`unknown column ${column} in where`);
    return matchesFilter(column, record[column], expected);
  });
}

/**
 * Returns only the selected columns, as Prisma does when a query passes
 * `select`. Without one, the whole row.
 */
function project<Row extends object>(row: Row, select?: Select): Partial<Row> {
  if (!select) return { ...row };
  for (const [column, value] of Object.entries(select)) {
    if (value !== true) unsupported(`nested select on ${column}`);
    if (!(column in row)) unsupported(`unknown column ${column} in select`);
  }
  return Object.fromEntries(
    Object.entries(row).filter(([column]) => select[column] === true)
  ) as Partial<Row>;
}

/** Sorts rows by one or more columns, as `orderBy` does. */
function sortRows<Row extends object>(rows: Row[], orderBy?: OrderBy): Row[] {
  if (!orderBy) return rows;
  const keys = (Array.isArray(orderBy) ? orderBy : [orderBy]).map((entry) => {
    const [column, direction] = Object.entries(entry)[0] ?? [];
    if (!column || Object.keys(entry).length !== 1) {
      unsupported(`orderBy entries name one column each`);
    }
    return { column, sign: direction === "desc" ? -1 : 1 };
  });
  return [...rows].sort((a, b) => {
    for (const { column, sign } of keys) {
      const left = (a as Record<string, unknown>)[column];
      const right = (b as Record<string, unknown>)[column];
      const l = left instanceof Date ? left.getTime() : String(left);
      const r = right instanceof Date ? right.getTime() : String(right);
      if (l < r) return -sign;
      if (l > r) return sign;
    }
    return 0;
  });
}

/** Drops `undefined` values the way Prisma ignores them in `data`. */
function defined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined)
  ) as Partial<T>;
}

/** The select `filterOrganizationsWithPush` sends to read owner tiers. */
const PUSH_TIER_SELECT = {
  id: true,
  owner: {
    select: {
      tierId: true,
      tier: {
        select: { tierLimit: { select: { canUsePushNotifications: true } } },
      },
      customTierLimit: { select: { canUsePushNotifications: true } },
    },
  },
};

/** An organization as the push tier select returns it. */
function withOwnerTier({ id, userId }: FakeOrganizationRow) {
  const tierId = pushStore.userTiers.get(userId) ?? "free";
  const tierPush = pushStore.tierPush.get(tierId);
  const customPush = pushStore.customTierPush.get(userId);
  return {
    id,
    owner: {
      tierId,
      tier: {
        tierLimit:
          tierPush === undefined ? null : { canUsePushNotifications: tierPush },
      },
      customTierLimit:
        customPush === undefined
          ? null
          : { canUsePushNotifications: customPush },
    },
  };
}

type FindManyArgs = {
  where?: Where;
  select?: Select;
  orderBy?: OrderBy;
  skip?: number;
};

/** A `findMany` over `rows` for the arguments the push code sends. */
function findMany<Row extends object>(
  call: string,
  rows: () => Row[],
  args: FindManyArgs = {}
) {
  assertArguments(call, args, ["where", "select", "orderBy", "skip"]);
  const found = sortRows(
    rows().filter((row) => matches(row, args.where)),
    args.orderBy
  ).slice(args.skip ?? 0);
  return Promise.resolve(found.map((row) => project(row, args.select)));
}

/** The subset of the Prisma client the push module and its routes call. */
export const pushDb = {
  organization: {
    findMany: (args: { where?: Where; select?: Select } = {}) => {
      assertArguments("organization.findMany", args, ["where", "select"]);
      if (!isDeepStrictEqual(args.select, PUSH_TIER_SELECT)) {
        unsupported(
          `unexpected select in organization.findMany: ${JSON.stringify(
            args.select
          )}`
        );
      }
      return Promise.resolve(
        pushStore.organizations
          .filter((row) => matches(row, args.where))
          .map(withOwnerTier)
      );
    },
  },
  userOrganization: {
    findMany: (args?: FindManyArgs) =>
      findMany("userOrganization.findMany", () => pushStore.memberships, args),
  },
  pushToken: {
    findMany: (args?: FindManyArgs) =>
      findMany("pushToken.findMany", () => pushStore.pushTokens, args),
    upsert: (args: {
      where: { token: string };
      create: Partial<FakePushTokenRow>;
      update: Partial<FakePushTokenRow>;
      select?: Select;
    }) => {
      assertArguments("pushToken.upsert", args, [
        "where",
        "create",
        "update",
        "select",
      ]);
      const { where, create, update, select } = args;
      const existing = pushStore.pushTokens.find(
        (row) => row.token === where.token
      );
      if (existing) {
        Object.assign(existing, defined(update));
        return Promise.resolve(project(existing, select));
      }
      const row = {
        id: `pt-${pushStore.pushTokens.length + 1}`,
        disabledAt: null,
        deviceName: null,
        appVersion: null,
        ...defined(create),
      } as FakePushTokenRow;
      pushStore.pushTokens.push(row);
      return Promise.resolve(project(row, select));
    },
    deleteMany: (args: { where: Where }) => {
      assertArguments("pushToken.deleteMany", args, ["where"]);
      const before = pushStore.pushTokens.length;
      pushStore.pushTokens = pushStore.pushTokens.filter(
        (row) => !matches(row, args.where)
      );
      return Promise.resolve({ count: before - pushStore.pushTokens.length });
    },
    updateMany: (args: { where: Where; data: Partial<FakePushTokenRow> }) => {
      assertArguments("pushToken.updateMany", args, ["where", "data"]);
      const rows = pushStore.pushTokens.filter((row) =>
        matches(row, args.where)
      );
      rows.forEach((row) => Object.assign(row, defined(args.data)));
      return Promise.resolve({ count: rows.length });
    },
  },
  notificationPreference: {
    findUnique: (args: { where: { userId: string }; select?: Select }) => {
      assertArguments("notificationPreference.findUnique", args, [
        "where",
        "select",
      ]);
      const row = pushStore.preferences.find((candidate) =>
        matches(candidate, args.where)
      );
      return Promise.resolve(row ? project(row, args.select) : null);
    },
    findMany: (args?: FindManyArgs) =>
      findMany(
        "notificationPreference.findMany",
        () => pushStore.preferences,
        args
      ),
    upsert: (args: {
      where: { userId: string };
      create: Partial<FakePreferenceRow>;
      update: Partial<FakePreferenceRow>;
      select?: Select;
    }) => {
      assertArguments("notificationPreference.upsert", args, [
        "where",
        "create",
        "update",
        "select",
      ]);
      const { where, create, update, select } = args;
      const existing = pushStore.preferences.find(
        (row) => row.userId === where.userId
      );
      if (existing) {
        Object.assign(existing, defined(update));
        return Promise.resolve(project(existing, select));
      }
      const row = {
        pushEnabled: true,
        bookings: true,
        audits: true,
        stockAndReminders: true,
        ...defined(create),
      } as FakePreferenceRow;
      pushStore.preferences.push(row);
      return Promise.resolve(project(row, select));
    },
  },
};
