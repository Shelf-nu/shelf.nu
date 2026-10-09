/**
 * Asset Model Assets endpoint — route tests
 *
 * Covers the three things this endpoint must get right, none of which are
 * visible from its happy path: that a model id from another organization is
 * refused rather than leaked, that the caller's own filters reach the asset
 * query unchanged (the sheet's contents and the row's count are the same
 * query), and that a viewer who cannot see all custody never receives a
 * foreign custodian's identity in the response body.
 *
 * Assertions read the returned payload rather than rendered output: the
 * redaction this endpoint relies on is a server-side control, and a UI that
 * hides a value it was still sent is exactly the bypass it exists to prevent.
 *
 * @see {@link file://./../../../app/routes/api+/asset-models.$assetModelId.assets.ts}
 */
import type { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import { describe, expect, it, vitest, beforeEach } from "vitest";
import { loader } from "~/routes/api+/asset-models.$assetModelId.assets";

// why: real single-fetch `data()` does not return an inspectable Response;
// the redaction test needs to read the actual JSON body, so this mock keeps
// the loader's real return path but makes it assertable.
vitest.mock("react-router", async () => {
  const actual = await vitest.importActual("react-router");
  return {
    ...actual,
    data: vitest.fn((body: unknown, init?: ResponseInit) => {
      return new Response(JSON.stringify(body), {
        status: init?.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  };
});

// why: the route's job is authorization + filter assembly; the asset query
// itself is covered by the advanced index's own tests.
// why: the route resolves the viewer's timezone for date-filter truncation;
// the real resolver reads the DB.
vitest.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vitest.fn(),
}));
// why: the real resolver performs DB reads and session work; these tests
// assert on what the loader does with a given role, not on how it is derived.
vitest.mock("~/utils/roles.server", () => ({
  requirePermission: vitest.fn(),
}));
// why: settings resolution self-heals the stored column list against a DB.
// The endpoint only needs a columns array to hand to the filter parser.
vitest.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vitest.fn(),
}));
// why: the advanced asset query is raw SQL against Postgres and is covered by
// its own tests; here it is the seam whose ARGUMENTS are under assertion.
vitest.mock("~/modules/asset/service.server", () => ({
  getAdvancedPaginatedAndFilterableAssets: vitest.fn(),
}));
// why: isolates the org-scoping lookup so a cross-org model id can be
// simulated without seeding two organizations, and exposes the unfiltered
// count as a seam whose WHERE clause is asserted below.
vitest.mock("~/database/db.server", () => ({
  db: {
    assetModel: { findFirst: vitest.fn() },
    asset: { count: vitest.fn() },
  },
}));

import { db } from "~/database/db.server";
import { getAdvancedPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { requirePermission } from "~/utils/roles.server";

const context = {
  getSession: () => ({ userId: "user-1" }),
} as never;

function request(url: string) {
  return new Request(url);
}

/**
 * A `requirePermission` result for `role`, built from the real policy.
 * `custodySeeAll` defaults to hidden: the workspace toggles that widen custody
 * visibility default to off in production, so the redaction cases exercise
 * the common case.
 */
function caller(
  role: string,
  {
    organizationId,
    custodySeeAll = false,
  }: { organizationId: string; custodySeeAll?: boolean }
) {
  const ctx = permissionContext({
    roles: [role as OrganizationRoles],
    organizationId,
  });
  return {
    ...ctx,
    canUseBarcodes: false,
    access: {
      ...ctx.access,
      custody: { ...ctx.access.custody, seeAll: custodySeeAll },
    },
  };
}

/**
 * The WHERE clause the unfiltered count ran with, or `undefined` when it never
 * ran.
 *
 * Read through a declared shape rather than off the Prisma delegate's own
 * generic signature, so a renamed field in the clause is a failing assertion
 * here instead of an `unknown` the compiler waves through.
 */
function unfilteredCountWhere(): Record<string, unknown> | undefined {
  const calls = vitest.mocked(db.asset.count).mock.calls as unknown as Array<
    [{ where?: Record<string, unknown> }]
  >;

  return calls[0]?.[0]?.where;
}

describe("asset model assets endpoint", () => {
  beforeEach(() => {
    // Call history, not just return values: every assertion below reads
    // `.mock.calls[0]`, which without this returns the FIRST test's call for
    // the whole file rather than the current test's.
    vitest.clearAllMocks();

    vitest.mocked(resolveUserFormatPrefsById).mockResolvedValue({
      timeZone: "Asia/Tokyo",
    } as never);

    vitest.mocked(requirePermission).mockResolvedValue(
      caller("ADMIN", {
        organizationId: "org-1",
        custodySeeAll: false,
      }) as never
    );
    vitest.mocked(getAssetIndexSettings).mockResolvedValue({
      mode: "ADVANCED",
      columns: [],
    } as never);
    vitest.mocked(db.assetModel.findFirst).mockResolvedValue({
      id: "am-1",
      name: "MacBook Pro 16",
    } as never);
    vitest.mocked(db.asset.count).mockResolvedValue(0 as never);
    vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mockResolvedValue({
      assets: [],
      totalAssets: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    } as never);
  });

  it("refuses a model from another organization", async () => {
    vitest.mocked(db.assetModel.findFirst).mockResolvedValue(null);

    // Returned, not thrown: a fetcher consuming this route has no in-tree
    // error boundary, so throwing would escalate to the app shell instead of
    // surfacing in the sheet. The refusal must still be a 404 carrying no
    // detail about the foreign model.
    const response = await loader({
      context,
      request: request("https://x.test/api/asset-models/am-1/assets"),
      params: { assetModelId: "am-1" },
    } as never);

    expect((response as unknown as Response).status).toBe(404);
    const body = await (response as unknown as Response).json();
    expect(body.error).toBeTruthy();
    expect(
      vitest.mocked(getAdvancedPaginatedAndFilterableAssets)
    ).not.toHaveBeenCalled();
  });

  it("appends the model filter to the caller's current filters", async () => {
    await loader({
      context,
      request: request(
        "https://x.test/api/asset-models/am-1/assets?filters=status%3Dis%3AAVAILABLE"
      ),
      params: { assetModelId: "am-1" },
    } as never);

    const [args] = vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mock
      .calls[0];
    expect(args.filters).toContain("status=is:AVAILABLE");
    expect(args.filters).toContain("assetModel=is:am-1");
    // An ADMIN caller gets the unrestricted query, matching the index loader.
    expect(args.availableToBookOnly).toBe(false);
  });

  it("restricts to bookable assets for a SELF_SERVICE caller, matching the index loader", async () => {
    vitest.mocked(requirePermission).mockResolvedValue(
      caller("SELF_SERVICE", {
        organizationId: "org-1",
        custodySeeAll: false,
      }) as never
    );

    await loader({
      context,
      request: request("https://x.test/api/asset-models/am-1/assets"),
      params: { assetModelId: "am-1" },
    } as never);

    const [args] = vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mock
      .calls[0];
    expect(args.availableToBookOnly).toBe(true);
    // The unfiltered count is narrowed the same way: counted over the wider
    // set, it would report assets this viewer is shown nowhere else.
    expect(unfilteredCountWhere()).toMatchObject({ availableToBook: true });
  });

  it("counts the model's own assets unfiltered when nothing matched, scoped to the caller's organization", async () => {
    vitest.mocked(db.asset.count).mockResolvedValue(52 as never);

    const response = (await loader({
      context,
      request: request(
        "https://x.test/api/asset-models/am-1/assets?filters=status%3Dis%3AAVAILABLE"
      ),
      params: { assetModelId: "am-1" },
    } as never)) as unknown as Response;

    expect(unfilteredCountWhere()).toEqual({
      // From `requirePermission`, never from the request: a count widened past
      // the caller's workspace reports another organization's inventory.
      organizationId: "org-1",
      // The rollup this sheet drills into counts INDIVIDUAL assets only, so a
      // count including stock pools would not describe the same set.
      type: "INDIVIDUAL",
      assetModelId: "am-1",
      // The index's default Active view hides archived assets, and clearing
      // filters never shows them, so they are not "hidden by your filters".
      archivedAt: null,
    });

    const body = (await response.json()) as { unfilteredAssets: number | null };
    // What separates "your filters exclude everything in this model" from "this
    // model is empty" in the sheet's one empty-state sentence.
    expect(body.unfilteredAssets).toBe(52);
  });

  it("counts within the index's Archived view when the caller is in it (issue #382)", async () => {
    await loader({
      context,
      request: request(
        "https://x.test/api/asset-models/am-1/assets?filters=archived%3Darchived"
      ),
      params: { assetModelId: "am-1" },
    } as never);

    // The view is not a filter the user can clear, so it scopes this count too.
    expect(unfilteredCountWhere()).toMatchObject({
      assetModelId: "am-1",
      archivedAt: { not: null },
    });
  });

  it("holds a member without asset: archive to the Active view (issue #382)", async () => {
    // A BASE member never sees the Archived tab. Typing `archived=archived`
    // into the forwarded string must not hand them the archived set anyway.
    vitest
      .mocked(requirePermission)
      .mockResolvedValue(caller("BASE", { organizationId: "org-1" }) as never);

    await loader({
      context,
      request: request(
        "https://x.test/api/asset-models/am-1/assets?filters=archived%3Darchived"
      ),
      params: { assetModelId: "am-1" },
    } as never);

    expect(unfilteredCountWhere()).toMatchObject({
      assetModelId: "am-1",
      archivedAt: null,
    });
  });

  it("skips the unfiltered count when the filtered set has rows", async () => {
    vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mockResolvedValue({
      assets: [{ id: "asset-1" }],
      totalAssets: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
    } as never);

    const response = (await loader({
      context,
      request: request("https://x.test/api/asset-models/am-1/assets"),
      params: { assetModelId: "am-1" },
    } as never)) as unknown as Response;

    // A sheet with rows states its own count, so paying for a second query on
    // every open would buy a sentence that is never rendered.
    expect(vitest.mocked(db.asset.count)).not.toHaveBeenCalled();
    const body = (await response.json()) as { unfilteredAssets: number | null };
    expect(body.unfilteredAssets).toBeNull();
  });

  it("redacts a foreign custodian's identity when the viewer cannot see all custody", async () => {
    // "Jane Doe" belongs to a different user than the caller (context's
    // userId is "user-1"), so a restricted viewer must not receive her
    // identity anywhere in the response body — a UI-only "private" chip is
    // not enough, since reading the network response would bypass it. The
    // fixture mirrors the real query's shape: `query.server.ts`'s
    // `custody_agg` projects `tm.name` at BOTH `custody[].name` (used for
    // sorting/display) and `custody[].custodian.name`; `redactCustodianForViewer`
    // clears both.
    vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mockResolvedValue({
      assets: [
        {
          id: "asset-1",
          custody: [
            {
              name: "Jane Doe",
              custodian: {
                name: "Jane Doe",
                user: {
                  id: "user-2",
                  firstName: "Jane",
                  lastName: "Doe",
                  profilePicture: null,
                  email: "jane@example.com",
                },
              },
            },
          ],
        },
      ],
      totalAssets: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
    } as never);

    const response = (await loader({
      context,
      request: request("https://x.test/api/asset-models/am-1/assets"),
      params: { assetModelId: "am-1" },
    } as never)) as unknown as Response;

    const body = (await response.json()) as {
      assets: Array<{
        custody: Array<{
          name: string;
          custodian: { name: string; user: unknown };
        }>;
      }>;
    };

    expect(JSON.stringify(body)).not.toContain("jane@example.com");
    expect(JSON.stringify(body)).not.toContain("Jane Doe");
    expect(body.assets[0].custody[0].custodian.name).toBe("");
    expect(body.assets[0].custody[0].custodian.user).toBeNull();
    // The top-level mirror `query.server.ts`'s raw SQL also projects — see
    // the comment above — must be cleared too, not just `custodian.name`.
    expect(body.assets[0].custody[0].name).toBe("");
  });

  it("drops view-scoped params that do not apply to an asset list", async () => {
    await loader({
      context,
      request: request(
        "https://x.test/api/asset-models/am-1/assets?filters=view%3Dmodels%26modelSortBy%3Dvalue"
      ),
      params: { assetModelId: "am-1" },
    } as never);

    const [args] = vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mock
      .calls[0];
    expect(args.filters).not.toContain("view=");
    expect(args.filters).not.toContain("modelSortBy=");
  });

  it("passes the viewer's timezone so date filters truncate the same day as the row's count", async () => {
    await loader({
      context,
      request: request("https://x.test/api/asset-models/am-1/assets"),
      params: { assetModelId: "am-1" },
    } as never);

    const [args] = vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mock
      .calls[0];
    // Omitting it falls through to the query helper's UTC default, which
    // truncates a different calendar day than the model row's count does.
    expect(args.timeZone).toBe("Asia/Tokyo");
  });
});
