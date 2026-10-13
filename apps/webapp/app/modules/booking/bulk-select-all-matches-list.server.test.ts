/**
 * Bulk booking actions: "Select all" acts on the rows the list shows.
 *
 * "Select all N entries" on `/bookings` posts the list's URL params instead of
 * ids. The server then resolves the selection itself, so it must reach the
 * same N rows the list counted: the same search, status, team-member and tag
 * filters, the same hidden ARCHIVED / CANCELLED default, the same rule that
 * hides other people's drafts, and the same custodian scope for a viewer who
 * may only see their own bookings. Anything wider and the typed delete count,
 * an archive or a cancel reaches bookings the user never saw.
 *
 * Asserts on the `where` handed to Prisma, because the `where` is the boundary.
 *
 * @see {@link file://./service.server.ts} `getBulkBookingsWhereInput`, `getBookings`
 * @see {@link file://./../../routes/_layout+/bookings._index.tsx} the list loader
 */
import { BookingStatus, OrganizationRoles } from "@prisma/client";
import { accessFor } from "@helpers/role-access";
import { db } from "~/database/db.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import type { RoleAccess } from "~/utils/permissions/role-access";
import {
  bulkArchiveBookings,
  bulkCancelBookings,
  bulkDeleteBookings,
  getBookings,
  getBookingsFilterData,
} from "./service.server";

// @vitest-environment node

// why: the subject is the `where` each side builds, not what a database
// returns. `booking.count` because `getBookings` issues it beside `findMany`;
// `teamMember.findMany` because `resolveCustodianScope` reads it;
// `user.findUniqueOrThrow` because delete and cancel load the actor beside
// their read.
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
  },
}));

const findManyMock = db.booking.findMany as unknown as ReturnType<
  typeof vitest.fn
>;

const ORG = "org-1";
const ME = "user-me";

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

type SelectAllArgs = {
  bookingIds: string[];
  organizationId: string;
  userId: string;
  access: RoleAccess;
  currentSearchParams: string;
};

const HINTS = { timeZone: "UTC", locale: "en-US" };

const BULK_ACTIONS = {
  delete: (args: SelectAllArgs) =>
    bulkDeleteBookings({ ...args, hints: HINTS, confirmation: "1" }),
  archive: (args: SelectAllArgs) => bulkArchiveBookings(args),
  cancel: (args: SelectAllArgs) =>
    bulkCancelBookings({ ...args, hints: HINTS }),
};

/**
 * The `where` the bookings index sends to Prisma for `/bookings?<qs>`.
 * Calls the two services the same way the index loader does.
 */
async function listWhere(qs: string, access: RoleAccess) {
  findManyMock.mockClear();

  const {
    page,
    perPage,
    search,
    status,
    teamMemberIds,
    orderBy,
    orderDirection,
    selfServiceData,
    tags,
  } = await getBookingsFilterData({
    request: new Request(`http://localhost/bookings?${qs}`),
    userId: ME,
    canSeeAllBookings: access.bookings.seeAll,
    organizationId: ORG,
  });

  await getBookings({
    organizationId: ORG,
    page,
    perPage,
    search,
    userId: ME,
    ...(status && { statuses: [status] }),
    custodianTeamMemberIds: teamMemberIds,
    ...selfServiceData,
    orderBy,
    orderDirection,
    tags,
    includeAssets: false,
  });

  return findManyMock.mock.calls[0][0].where;
}

/**
 * The `where` a bulk action sends to Prisma for "Select all" on
 * `/bookings?<qs>`. The read is failed on purpose so the action stops before
 * any write; the query it attempted is what is under test.
 */
async function selectAllWhere(
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
    })
  ).rejects.toMatchObject({ cause: stop });

  return findManyMock.mock.calls[0][0].where;
}

/** URLs the bookings index can be on when the user picks "Select all". */
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

beforeEach(() => {
  vitest.clearAllMocks();
});

describe("select all matches the bookings list", () => {
  describe.each(WRITES_EVERY_BOOKING)("for %s", (_role, access) => {
    it.each(LIST_URLS)("on /bookings?%s", async (qs) => {
      expect(await selectAllWhere(qs, access)).toEqual(
        await listWhere(qs, access)
      );
    });
  });

  describe.each(WRITES_OWN_BOOKINGS)("for %s", (_role, access) => {
    it.each(LIST_URLS)(
      "on /bookings?%s, narrowed to the bookings they may write",
      async (qs) => {
        expect(await selectAllWhere(qs, access)).toEqual({
          AND: [await listWhere(qs, access), MINE_TO_WRITE],
        });
      }
    );
  });
});

describe("select all with no filters", () => {
  it("leaves out archived and cancelled bookings and other people's drafts", async () => {
    expect(
      await selectAllWhere("", accessFor([OrganizationRoles.ADMIN]))
    ).toEqual({
      organizationId: ORG,
      AND: [ONLY_MY_DRAFTS],
      status: HIDE_ARCHIVED_AND_CANCELLED,
    });
  });

  it("keeps a SELF_SERVICE user to the bookings in their custody", async () => {
    expect(
      await selectAllWhere("", accessFor([OrganizationRoles.SELF_SERVICE]))
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
});

describe.each(Object.keys(BULK_ACTIONS) as Array<keyof typeof BULK_ACTIONS>)(
  "bulk %s",
  (action) => {
    it("applies the list search to select all", async () => {
      expect(
        await selectAllWhere(
          "s=Batch",
          accessFor([OrganizationRoles.ADMIN]),
          action
        )
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
  }
);

it("refuses select all when there is no user whose list it stands for", async () => {
  await expect(
    bulkArchiveBookings({
      bookingIds: [ALL_SELECTED_KEY],
      organizationId: ORG,
      access: accessFor([OrganizationRoles.ADMIN]),
      currentSearchParams: "",
    })
  ).rejects.toThrow(
    "Cannot resolve which bookings this list shows. Please contact support."
  );
  expect(findManyMock).not.toHaveBeenCalled();
});
