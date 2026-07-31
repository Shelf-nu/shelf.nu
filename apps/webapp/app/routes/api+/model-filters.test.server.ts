/**
 * Regression tests for `/api/model-filters`.
 *
 * This endpoint backs the search box inside every `DynamicSelect` /
 * `DynamicDropdown`. The picker renders the ROUTE LOADER's records until the
 * user types, then swaps to this endpoint's results and passes both through the
 * same `renderItem`. If the two shapes disagree, `renderItem` reads `undefined`
 * and the row silently renders as nothing — a blank dropdown with a non-zero
 * "Showing N out of M" footer.
 *
 * @see {@link file://./model-filters.ts}
 * @see {@link file://./../../hooks/use-model-filters.ts}
 */
import { BookingStatus } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ADDABLE_BOOKING_STATUSES } from "~/modules/booking/constants";
import { loader } from "~/routes/api+/model-filters";

// why: mocking Remix's data() so the loader returns a plain Response we can read
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (payload: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(payload), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

const dbMocks = vi.hoisted(() => ({
  dynamicFindMany: vi.fn(),
}));

// why: exercising the where-clause + response shaping without a real database
vi.mock("~/database/db.server", () => ({
  db: {
    booking: { dynamicFindMany: dbMocks.dynamicFindMany },
    teamMember: { dynamicFindMany: dbMocks.dynamicFindMany },
    kit: { dynamicFindMany: dbMocks.dynamicFindMany },
  },
}));

const orgMocks = vi.hoisted(() => ({
  getSelectedOrganization: vi.fn(),
}));

// why: bypassing cookie/session resolution to drive the caller's role directly
vi.mock("~/modules/organization/context.server", () => ({
  getSelectedOrganization: orgMocks.getSelectedOrganization,
}));

/**
 * Single definition of the draft-visibility clause, shared by the mock below
 * and by the assertions, so the two can never drift apart.
 *
 * Hoisted because `vi.mock` factories are lifted above module scope.
 *
 * The real implementation's shape is pinned by its own test in
 * `modules/booking/service.server.test.ts`, so restating it here cannot mask a
 * production change — that test fails first.
 */
const clause = vi.hoisted(() => ({
  buildDraftVisibility: (userId: string) => ({
    OR: [
      { status: { not: "DRAFT" } },
      { AND: [{ status: "DRAFT" }, { creatorId: userId }] },
    ],
  }),
}));

// why: service.server pulls in the whole booking domain (schedulers, emails);
// the clause itself is pure, so a local equivalent keeps the test fast.
vi.mock("~/modules/booking/service.server", () => ({
  bookingDraftVisibilityClause: clause.buildDraftVisibility,
}));

const ORG_ID = "org-1";

/**
 * Builds the loader args for a given query string.
 *
 * @param query - Raw query string, without the leading `?`.
 * @returns Loader args carrying a session for `user-1`.
 */
function buildArgs(query: string): LoaderFunctionArgs {
  return {
    request: new Request(`http://localhost/api/model-filters?${query}`),
    params: {},
    context: { getSession: () => ({ userId: "user-1" }) },
  } as unknown as LoaderFunctionArgs;
}

/**
 * Invokes the loader and returns the mocked `data()` Response.
 *
 * The double cast is needed because React Router types `data()` as returning
 * `DataWithResponseInit`; our mock returns a real `Response` instead so the
 * test can read the serialized body.
 */
async function callLoader(query: string): Promise<Response> {
  return (await loader(buildArgs(query))) as unknown as Response;
}

/** Returns the `where` Prisma passed on the most recent query. */
function lastWhere() {
  return dbMocks.dynamicFindMany.mock.calls.at(-1)?.[0]?.where;
}

/**
 * Reads the `filters` array out of a loader response.
 *
 * @param response - Response produced by {@link callLoader}.
 * @returns The filter items the picker would render.
 */
async function readFilters(response: Response) {
  const body = await response.json();
  return body.filters ?? body.payload?.filters ?? [];
}

/** The clause every booking read path AND-s in — drafts are creator-only. */
const DRAFT_VISIBILITY = clause.buildDraftVisibility("user-1");

describe("GET /api/model-filters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgMocks.getSelectedOrganization.mockResolvedValue({
      organizationId: ORG_ID,
    });
  });

  describe("result shape", () => {
    it("exposes the record's own fields at the top level so renderItem sees them", async () => {
      // A booking as the route loader would hand it to the picker.
      dbMocks.dynamicFindMany.mockResolvedValue([
        {
          id: "booking-1",
          name: "Barclays Vibra",
          status: BookingStatus.RESERVED,
          from: new Date("2026-09-01T10:00:00Z"),
          to: new Date("2026-09-02T10:00:00Z"),
        },
      ]);

      const filters = await readFilters(
        await callLoader("name=booking&queryKey=name&queryValue=Barclays")
      );

      // The bug: `status` was absent, so the dialogs' `isValidBooking(item)`
      // returned false and the row rendered as `null`.
      expect(filters[0]).toMatchObject({
        id: "booking-1",
        name: "Barclays Vibra",
        status: BookingStatus.RESERVED,
      });
      expect(filters[0].from).toBeDefined();
      expect(filters[0].to).toBeDefined();
    });

    it("keeps the id/name/color/metadata contract that existing pickers rely on", async () => {
      dbMocks.dynamicFindMany.mockResolvedValue([
        { id: "tm-1", name: "Ada Lovelace", userId: "user-9", color: "#fff" },
      ]);

      const filters = await readFilters(
        await callLoader("name=teamMember&queryKey=name&queryValue=Ada")
      );

      expect(filters[0].id).toBe("tm-1");
      expect(filters[0].name).toBe("Ada Lovelace");
      expect(filters[0].color).toBe("#fff");
      expect(filters[0].metadata).toMatchObject({ id: "tm-1" });
      // Same bug class: `renderItem` reads `item.metadata?.userId` here.
      expect(filters[0].userId).toBe("user-9");
    });
  });

  describe("booking status scoping", () => {
    beforeEach(() => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);
    });

    it("defaults to upcoming bookings only, so the advanced filter is unchanged", async () => {
      await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

      expect(lastWhere().status).toEqual({
        in: [
          BookingStatus.RESERVED,
          BookingStatus.ONGOING,
          BookingStatus.OVERDUE,
        ],
      });
    });

    it("honours the statuses a caller asks for, including DRAFT", async () => {
      await loader(
        buildArgs(
          `name=booking&queryKey=name&queryValue=x&status=${ADDABLE_BOOKING_STATUSES.join(
            ","
          )}`
        )
      );

      expect(lastWhere().status.in).toContain(BookingStatus.DRAFT);
      expect(lastWhere().status.in).toEqual(
        expect.arrayContaining([...ADDABLE_BOOKING_STATUSES])
      );
    });

    it("rejects a status value that is not a BookingStatus", async () => {
      const response = await callLoader(
        "name=booking&queryKey=name&status=NOT_A_STATUS"
      );

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(dbMocks.dynamicFindMany).not.toHaveBeenCalled();
    });
  });

  describe("draft visibility", () => {
    beforeEach(() => {
      dbMocks.dynamicFindMany.mockResolvedValue([]);
    });

    it("restricts drafts to their creator, regardless of caller role", async () => {
      await loader(
        buildArgs(
          `name=booking&queryKey=name&status=${ADDABLE_BOOKING_STATUSES.join(
            ","
          )}`
        )
      );

      // Nested in AND so the search OR cannot widen it back open.
      expect(lastWhere().AND).toEqual([DRAFT_VISIBILITY]);
    });

    it("applies even when the caller does not ask for DRAFT", async () => {
      await loader(buildArgs("name=booking&queryKey=name&queryValue=x"));

      expect(lastWhere().AND).toEqual([DRAFT_VISIBILITY]);
    });

    it("does not add the clause to non-booking searches", async () => {
      await loader(buildArgs("name=kit&queryKey=name&queryValue=x"));

      expect(lastWhere().AND).toBeUndefined();
    });
  });
});
