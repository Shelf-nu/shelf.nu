/**
 * Bulk booking actions: "Select all" acts on the rows the list shows.
 *
 * Three pages render the bookings list with bulk delete, archive and cancel:
 * `/bookings`, a kit's Bookings tab and an asset's Bookings tab. "Select all N
 * entries" posts the page's URL params and which of those lists it is, instead
 * of ids. The server then resolves the selection itself, so it must reach the
 * same N rows that page's loader counted: the same search, status, team-member
 * and tag filters, the same default statuses, the same rule that hides other
 * people's drafts, the same kit or asset, and the same custodian scope for a
 * viewer who may only see their own bookings. Anything wider and the typed
 * delete count, an archive or a cancel reaches bookings the user never saw.
 *
 * Asserts on the `where` handed to Prisma, because the `where` is the boundary.
 * Each list is compared with the `where` its own route loader builds.
 *
 * @see {@link file://./service.server.ts} `getBulkBookingsWhereInput`, `getBookingsListWhereParams`
 * @see {@link file://./../../routes/_layout+/bookings._index.tsx} the index loader
 * @see {@link file://./../../routes/_layout+/kits.$kitId.bookings.tsx} the kit tab loader
 * @see {@link file://./../../routes/_layout+/assets.$assetId.bookings.tsx} the asset tab loader
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { accessFor } from "@helpers/role-access";
import { db } from "~/database/db.server";
import { loader as assetTabLoader } from "~/routes/_layout+/assets.$assetId.bookings";
import { loader as indexLoader } from "~/routes/_layout+/bookings._index";
import { loader as kitTabLoader } from "~/routes/_layout+/kits.$kitId.bookings";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { RoleAccess } from "~/utils/permissions/role-access";
import { requirePermission } from "~/utils/roles.server";
import {
  bulkArchiveBookings,
  bulkCancelBookings,
  bulkDeleteBookings,
} from "./service.server";

// @vitest-environment node

// why: the subject is the `where` each side builds, not what a database
// returns. `booking.count` because `getBookings` issues it beside `findMany`;
// `teamMember.findMany` because `resolveCustodianScope` reads it;
// `user.findUniqueOrThrow` because delete and cancel load the actor beside
// their read; `tag.findMany` and `kit.findFirst` because the index and kit
// tab loaders read them for their filters and header.
vitest.mock("~/database/db.server", () => ({
  db: {
    booking: {
      findMany: vitest.fn().mockResolvedValue([]),
      count: vitest.fn().mockResolvedValue(0),
    },
    teamMember: {
      findMany: vitest.fn().mockResolvedValue([{ id: "tm-me" }]),
    },
    user: {
      findUniqueOrThrow: vitest.fn().mockResolvedValue({
        id: "user-me",
        firstName: "Me",
        lastName: "Myself",
        displayName: null,
      }),
    },
    tag: { findMany: vitest.fn().mockResolvedValue([]) },
    kit: { findFirst: vitest.fn().mockResolvedValue({ name: "Rack Kit" }) },
  },
}));

// why: the real gate loads the membership from the database; each loader is
// handed the access under test instead.
vitest.mock("~/utils/roles.server", () => ({
  requirePermission: vitest.fn(),
}));

// why: the loaders read team members for the custodian filter, the booking
// form and the notify picker. None of them decides which bookings a list holds.
vitest.mock("~/modules/team-member/service.server", () => ({
  getTeamMemberForCustodianFilter: vitest
    .fn()
    .mockResolvedValue({ teamMembers: [], totalTeamMembers: 0 }),
  getTeamMemberForForm: vitest.fn().mockResolvedValue({ teamMembers: [] }),
  getTeamMembersForNotify: vitest.fn().mockResolvedValue({}),
}));

// why: the tag filter's options, not the bookings the list holds.
vitest.mock("~/modules/tag/service.server", () => ({
  getTagsForBookingTagsFilter: vitest
    .fn()
    .mockResolvedValue({ tags: [], totalTags: 0 }),
}));

// why: row badges, computed for the rows already fetched.
vitest.mock("~/modules/booking/list-flags.server", () => ({
  decorateBookingsForList: vitest.fn().mockResolvedValue([]),
}));

const findManyMock = db.booking.findMany as unknown as ReturnType<
  typeof vitest.fn
>;
const requirePermissionMock = vitest.mocked(requirePermission);

const ORG = "org-1";
const ME = "user-me";
const KIT = "kit-1";
const ASSET = "asset-1";

/** Bookings that are not drafts, plus my own drafts. */
const ONLY_MY_DRAFTS = {
  OR: [
    { status: { not: BookingStatus.DRAFT } },
    { AND: [{ status: BookingStatus.DRAFT }, { creatorId: ME }] },
  ],
};

/** Bookings in my custody, on my user link or my team-member link. */
const IN_MY_CUSTODY = {
  OR: [{ custodianUserId: ME }, { custodianTeamMemberId: { in: ["tm-me"] } }],
};

/** Bookings a restricted role may write: ones it created or holds. */
const MINE_TO_WRITE = { OR: [{ creatorId: ME }, { custodianUserId: ME }] };

const HIDE_ARCHIVED_AND_CANCELLED = {
  notIn: [BookingStatus.ARCHIVED, BookingStatus.CANCELLED],
};

/** What a kit's or an asset's Bookings tab lists when no status is picked. */
const TAB_DEFAULT_STATUSES = {
  in: [
    BookingStatus.DRAFT,
    BookingStatus.COMPLETE,
    BookingStatus.ONGOING,
    BookingStatus.OVERDUE,
    BookingStatus.RESERVED,
  ],
};

/** Bookings holding an asset that is a member of kit `kitId`. */
function holdingKit(kitId: string) {
  return {
    some: { asset: { assetKits: { some: { kitId } } } },
  };
}

/** Bookings holding asset `assetId`. */
function holdingAsset(assetId: string) {
  return { some: { assetId: { in: [assetId] } } };
}

/** A page that renders the bookings list with bulk actions. */
type ListPage = {
  name: string;
  /** The page's path, before the query string */
  path: string;
  /** The route params its loader receives */
  params: Record<string, string>;
  /** What the page posts as its list on a bulk action */
  list: Record<string, string>;
  loader: (args: LoaderFunctionArgs) => Promise<unknown>;
};

const BOOKINGS_INDEX: ListPage = {
  name: "/bookings",
  path: "/bookings",
  params: {},
  list: { kind: "index" },
  loader: indexLoader,
};

const KIT_TAB: ListPage = {
  name: "a kit's Bookings tab",
  path: `/kits/${KIT}/bookings`,
  params: { kitId: KIT },
  list: { kind: "kit", kitId: KIT },
  loader: kitTabLoader,
};

const ASSET_TAB: ListPage = {
  name: "an asset's Bookings tab",
  path: `/assets/${ASSET}/bookings`,
  params: { assetId: ASSET },
  list: { kind: "asset", assetId: ASSET },
  loader: assetTabLoader,
};

const LIST_PAGES = [BOOKINGS_INDEX, KIT_TAB, ASSET_TAB];

type SelectAllArgs = {
  bookingIds: string[];
  organizationId: string;
  userId: string;
  access: RoleAccess;
  currentSearchParams: string;
  list?: ListPage["list"];
};

const HINTS = { timeZone: "UTC", locale: "en-US" };

// The list is posted as untyped form data; the cast lets this suite post the
// same shapes the route parses.
const BULK_ACTIONS = {
  delete: (args: SelectAllArgs) =>
    bulkDeleteBookings({
      ...args,
      hints: HINTS,
      confirmation: "1",
    } as Parameters<typeof bulkDeleteBookings>[0]),
  archive: (args: SelectAllArgs) =>
    bulkArchiveBookings(args as Parameters<typeof bulkArchiveBookings>[0]),
  cancel: (args: SelectAllArgs) =>
    bulkCancelBookings({ ...args, hints: HINTS } as Parameters<
      typeof bulkCancelBookings
    >[0]),
};

/**
 * The `where` a page's own loader sends to Prisma for `<path>?<qs>`, for a
 * viewer with `access`.
 */
async function listWhere(page: ListPage, qs: string, access: RoleAccess) {
  findManyMock.mockClear();
  requirePermissionMock.mockResolvedValue({
    organizationId: ORG,
    access,
    currentOrganization: { id: ORG },
  } as unknown as Awaited<ReturnType<typeof requirePermission>>);

  await page.loader({
    context: { getSession: () => ({ userId: ME }) },
    request: new Request(`http://localhost${page.path}?${qs}`),
    params: page.params,
  } as unknown as LoaderFunctionArgs);

  return findManyMock.mock.calls[0][0].where;
}

/**
 * The `where` a bulk action sends to Prisma for "Select all" on
 * `<path>?<qs>`. The read is failed on purpose so the action stops before any
 * write; the query it attempted is what is under test.
 */
async function selectAllWhere(
  page: { list?: ListPage["list"] },
  qs: string,
  access: RoleAccess,
  action: keyof typeof BULK_ACTIONS = "archive"
) {
  findManyMock.mockClear();
  const stop = new Error("stop after the read");
  findManyMock.mockRejectedValueOnce(stop);

  await expect(
    BULK_ACTIONS[action]({
      bookingIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      userId: ME,
      access,
      currentSearchParams: qs,
      list: page.list,
    })
  ).rejects.toMatchObject({ cause: stop });

  return findManyMock.mock.calls[0][0].where;
}

/** URLs a bookings list can be on when the user picks "Select all". */
const LIST_URLS = [
  "",
  "s=camera",
  "s=camera%2C+tripod",
  "status=ALL",
  "status=RESERVED",
  "status=reserved",
  "teamMember=tm-1&teamMember=tm-2",
  "tag=t-1",
  "tag=untagged",
  "s=camera&status=ONGOING&teamMember=tm-1&tag=t-1",
  "s=Batch&status=ALL&tag=t-1&tag=t-2&page=3&per_page=50&orderBy=name&orderDirection=desc",
];

const WRITES_EVERY_BOOKING: Array<[string, RoleAccess]> = [
  ["ADMIN", accessFor([OrganizationRoles.ADMIN])],
  ["OWNER", accessFor([OrganizationRoles.OWNER])],
];

const WRITES_OWN_BOOKINGS: Array<[string, RoleAccess]> = [
  ["SELF_SERVICE", accessFor([OrganizationRoles.SELF_SERVICE])],
  ["BASE", accessFor([OrganizationRoles.BASE])],
  [
    "SELF_SERVICE who may see every booking",
    accessFor([OrganizationRoles.SELF_SERVICE], {
      selfServiceCanSeeBookings: true,
    }),
  ],
  [
    "BASE who may see every booking",
    accessFor([OrganizationRoles.BASE], { baseUserCanSeeBookings: true }),
  ],
];

const ADMIN = accessFor([OrganizationRoles.ADMIN]);

beforeEach(() => {
  vitest.clearAllMocks();
});

describe.each(LIST_PAGES)("select all matches the list on $name", (page) => {
  describe.each(WRITES_EVERY_BOOKING)("for %s", (_role, access) => {
    it.each(LIST_URLS)("at ?%s", async (qs) => {
      expect(await selectAllWhere(page, qs, access)).toEqual(
        await listWhere(page, qs, access)
      );
    });
  });

  describe.each(WRITES_OWN_BOOKINGS)("for %s", (_role, access) => {
    it.each(LIST_URLS)(
      "at ?%s, narrowed to the bookings they may write",
      async (qs) => {
        expect(await selectAllWhere(page, qs, access)).toEqual({
          AND: [await listWhere(page, qs, access), MINE_TO_WRITE],
        });
      }
    );
  });
});

describe("select all with no filters", () => {
  it("leaves out archived and cancelled bookings and other people's drafts", async () => {
    expect(await selectAllWhere(BOOKINGS_INDEX, "", ADMIN)).toEqual({
      organizationId: ORG,
      AND: [ONLY_MY_DRAFTS],
      status: HIDE_ARCHIVED_AND_CANCELLED,
    });
  });

  it("keeps a SELF_SERVICE user to the bookings in their custody", async () => {
    expect(
      await selectAllWhere(
        BOOKINGS_INDEX,
        "",
        accessFor([OrganizationRoles.SELF_SERVICE])
      )
    ).toEqual({
      AND: [
        {
          organizationId: ORG,
          AND: [ONLY_MY_DRAFTS, IN_MY_CUSTODY],
          status: HIDE_ARCHIVED_AND_CANCELLED,
        },
        MINE_TO_WRITE,
      ],
    });
  });

  it("drops the custody scope for a BASE user the workspace lets see every booking", async () => {
    expect(
      await selectAllWhere(
        BOOKINGS_INDEX,
        "",
        accessFor([OrganizationRoles.BASE], { baseUserCanSeeBookings: true })
      )
    ).toEqual({
      AND: [
        {
          organizationId: ORG,
          AND: [ONLY_MY_DRAFTS],
          status: HIDE_ARCHIVED_AND_CANCELLED,
        },
        MINE_TO_WRITE,
      ],
    });
  });

  it("treats a request that names no list as the bookings index", async () => {
    expect(await selectAllWhere({ list: undefined }, "", ADMIN)).toEqual({
      organizationId: ORG,
      AND: [ONLY_MY_DRAFTS],
      status: HIDE_ARCHIVED_AND_CANCELLED,
    });
  });
});

describe.each(Object.keys(BULK_ACTIONS) as Array<keyof typeof BULK_ACTIONS>)(
  "bulk %s",
  (action) => {
    it("applies the list search to select all", async () => {
      expect(
        await selectAllWhere(BOOKINGS_INDEX, "s=Batch", ADMIN, action)
      ).toMatchObject({
        organizationId: ORG,
        status: HIDE_ARCHIVED_AND_CANCELLED,
        OR: [
          {
            OR: expect.arrayContaining([
              { name: { contains: "batch", mode: "insensitive" } },
              { description: { contains: "batch", mode: "insensitive" } },
            ]),
          },
        ],
      });
    });

    it("keeps select all on a kit's Bookings tab to that kit's bookings", async () => {
      expect(await selectAllWhere(KIT_TAB, "", ADMIN, action)).toEqual({
        organizationId: ORG,
        AND: [ONLY_MY_DRAFTS],
        status: TAB_DEFAULT_STATUSES,
        bookingAssets: holdingKit(KIT),
      });
    });

    it("keeps select all on an asset's Bookings tab to that asset's bookings", async () => {
      expect(await selectAllWhere(ASSET_TAB, "", ADMIN, action)).toEqual({
        organizationId: ORG,
        AND: [ONLY_MY_DRAFTS],
        status: TAB_DEFAULT_STATUSES,
        bookingAssets: holdingAsset(ASSET),
      });
    });
  }
);

describe("a kit or asset id posted with select all", () => {
  it("stays inside the caller's workspace when the kit belongs to another one", async () => {
    expect(
      await selectAllWhere(
        { list: { kind: "kit", kitId: "kit-of-org-2" } },
        "",
        ADMIN
      )
    ).toEqual({
      organizationId: ORG,
      AND: [ONLY_MY_DRAFTS],
      status: TAB_DEFAULT_STATUSES,
      bookingAssets: holdingKit("kit-of-org-2"),
    });
  });

  it("stays inside the caller's own bookings when the asset belongs to another workspace", async () => {
    expect(
      await selectAllWhere(
        { list: { kind: "asset", assetId: "asset-of-org-2" } },
        "",
        accessFor([OrganizationRoles.SELF_SERVICE])
      )
    ).toEqual({
      AND: [
        {
          organizationId: ORG,
          AND: [ONLY_MY_DRAFTS, IN_MY_CUSTODY],
          status: TAB_DEFAULT_STATUSES,
          bookingAssets: holdingAsset("asset-of-org-2"),
        },
        MINE_TO_WRITE,
      ],
    });
  });

  it("leaves an explicit selection to its ids", async () => {
    findManyMock.mockRejectedValueOnce(new Error("stop after the read"));

    await expect(
      BULK_ACTIONS.archive({
        bookingIds: ["bk-1", "bk-2"],
        organizationId: ORG,
        userId: ME,
        access: ADMIN,
        currentSearchParams: "",
        list: KIT_TAB.list,
      })
    ).rejects.toThrow();

    expect(findManyMock.mock.calls[0][0].where).toEqual({
      id: { in: ["bk-1", "bk-2"] },
      organizationId: ORG,
    });
  });
});

it("refuses select all when there is no user whose list it stands for", async () => {
  await expect(
    bulkArchiveBookings({
      bookingIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      access: ADMIN,
      currentSearchParams: "",
    })
  ).rejects.toThrow(
    "Cannot resolve which bookings this list shows. Please contact support."
  );
  expect(findManyMock).not.toHaveBeenCalled();
});
