/**
 * Unassigned Assets endpoint (the "No model" bucket): route tests
 *
 * This bucket has no id, so the cross-org check its sibling route performs on
 * `:assetModelId` has nothing to check here. What stands in its place is the
 * organization `requirePermission` resolves, and these tests pin that: a caller
 * cannot steer it through the query string, and a rejected permission is
 * answered rather than thrown.
 *
 * The rest covers the predicate. The rollup this endpoint drills into counts
 * `INDIVIDUAL` assets only, while "has no model" on its own also matches every
 * `QUANTITY_TRACKED` asset, so a sheet without the tracking-method predicate
 * lists rows the count above it never included.
 *
 * Assertions read the returned payload rather than rendered output: the
 * redaction this endpoint relies on is a server-side control, and a UI that
 * hides a value it was still sent is exactly the bypass it exists to prevent.
 *
 * @see {@link file://./../../../app/routes/api+/asset-models.unassigned-assets.ts}
 * @see {@link file://./asset-models.$assetModelId.assets.test.ts} The per-model route
 */
import type { OrganizationRoles } from "@prisma/client";
import { permissionContext } from "@helpers/role-access";
import { describe, expect, it, vitest, beforeEach } from "vitest";
import { loader } from "~/routes/api+/asset-models.unassigned-assets";

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
// why: present so the "no model lookup happens" assertion below has a spy to
// read. This route must never reach for an `AssetModel` row, because the
// bucket it serves is the absence of one. `asset.count` is the seam for the
// unfiltered count, whose WHERE clause is asserted below.
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
import { ShelfError } from "~/utils/error";
import { requirePermission } from "~/utils/roles.server";

const context = {
  getSession: () => ({ userId: "user-1" }),
} as never;

/**
 * Builds a request to this endpoint.
 *
 * `filters` carries the caller's whole search string as one value, so it is set
 * through `URLSearchParams` rather than concatenated: the value contains `=`
 * and `&` of its own and has to survive the round trip encoded.
 */
function request(filters?: string) {
  const search = new URLSearchParams();
  if (filters !== undefined) {
    search.set("filters", filters);
  }
  const query = search.toString();

  return new Request(
    `https://x.test/api/asset-models/unassigned-assets${
      query ? `?${query}` : ""
    }`
  );
}

/** The arguments the asset query was called with, for argument assertions. */
function queryArgs() {
  const [args] = vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mock
    .calls[0];
  return args;
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

describe("unassigned assets endpoint", () => {
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
    vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mockResolvedValue({
      assets: [],
      totalAssets: 0,
      page: 1,
      perPage: 20,
      totalPages: 0,
    } as never);
    vitest.mocked(db.asset.count).mockResolvedValue(0 as never);
  });

  it("scopes the query to the caller's own organization, never one named by the request", async () => {
    // Both places a caller could try to name a workspace: the endpoint's own
    // query string, and the filter string it forwards. Neither is consulted.
    const response = (await loader({
      context,
      request: new Request(
        `https://x.test/api/asset-models/unassigned-assets?organizationId=org-2&${new URLSearchParams(
          { filters: "organizationId=org-2&teamMember=is:tm-from-org-2" }
        ).toString()}`
      ),
      params: {},
    } as never)) as unknown as Response;

    expect(response.status).toBe(200);
    expect(queryArgs().organizationId).toBe("org-1");
  });

  it("never looks up an asset model, because the bucket is the absence of one", async () => {
    await loader({ context, request: request(), params: {} } as never);

    // A lookup here would mean an id had been invented for a bucket that has
    // none, which is the shape in which an ownership check gets skipped.
    expect(vitest.mocked(db.assetModel.findFirst)).not.toHaveBeenCalled();
  });

  it("returns a refused permission instead of throwing it", async () => {
    vitest.mocked(requirePermission).mockRejectedValue(
      new ShelfError({
        cause: null,
        message: "You are not authorized to view assets.",
        label: "Permission",
        status: 403,
        shouldBeCaptured: false,
      })
    );

    // Thrown, this would escape to the outermost boundary and take down the
    // app shell, because a fetcher on a resource route has none of its own.
    const response = (await loader({
      context,
      request: request(),
      params: {},
    } as never)) as unknown as Response;

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toBe("You are not authorized to view assets.");
    expect(
      vitest.mocked(getAdvancedPaginatedAndFilterableAssets)
    ).not.toHaveBeenCalled();
  });

  it("narrows to assets with no model, individually tracked only", async () => {
    const response = (await loader({
      context,
      request: request("status=is:AVAILABLE"),
      params: {},
    } as never)) as unknown as Response;

    const body = (await response.json()) as {
      error: null;
      assets: unknown[];
      totalAssets: number;
    };
    // `payload()` stamps `error: null` onto every success, so the presence of
    // the key says nothing. Read its value, and the fields beside it.
    expect(body.error).toBeNull();
    expect(body.assets).toEqual([]);
    expect(body.totalAssets).toBe(0);

    const { filters } = queryArgs();
    expect(filters).toContain("status=is:AVAILABLE");
    expect(filters).toContain("assetModel=is:without-model");
    // Without this, the sheet also lists every quantity-tracked asset, none of
    // which the rollup counted.
    expect(filters).toContain("type=is:INDIVIDUAL");
  });

  it("keeps the caller's own tracking-method filter beside the bucket's", async () => {
    await loader({
      context,
      request: request("type=is:QUANTITY_TRACKED"),
      params: {},
    } as never);

    const { filters } = queryArgs();
    // The rollup ANDs its own `type = 'INDIVIDUAL'` onto whatever the caller
    // filtered by, so both entries have to survive: replacing theirs would
    // widen the sheet past the count that opened it.
    expect(filters).toContain("type=is:QUANTITY_TRACKED");
    expect(filters).toContain("type=is:INDIVIDUAL");
    expect(filters?.match(/(^|&)type=/g)).toHaveLength(2);
  });

  it("does not repeat a tracking-method filter the caller already pinned to Individual", async () => {
    await loader({
      context,
      request: request("type=is:INDIVIDUAL"),
      params: {},
    } as never);

    const { filters } = queryArgs();
    // Narrowing twice to the same set is harmless here, but the sheet's
    // escape-hatch link runs through the same helper and is read back by the
    // filter UI, which would draw the duplicate as a second identical row.
    expect(filters).toContain("type=is:INDIVIDUAL");
    expect(filters?.match(/(^|&)type=/g)).toHaveLength(1);
  });

  it("restricts to bookable assets for a SELF_SERVICE caller, matching the index loader", async () => {
    vitest.mocked(requirePermission).mockResolvedValue(
      caller("SELF_SERVICE", {
        organizationId: "org-1",
        custodySeeAll: false,
      }) as never
    );

    await loader({ context, request: request(), params: {} } as never);

    expect(queryArgs().availableToBookOnly).toBe(true);
  });

  it("leaves an ADMIN caller's query unrestricted, matching the index loader", async () => {
    await loader({ context, request: request(), params: {} } as never);

    expect(queryArgs().availableToBookOnly).toBe(false);
  });

  it("redacts a foreign custodian's identity when the viewer cannot see all custody", async () => {
    // "Jane Doe" belongs to a different user than the caller (context's
    // userId is "user-1"), so a restricted viewer must not receive her
    // identity anywhere in the response body. A UI-only "private" chip is not
    // enough, since reading the network response would bypass it. The
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
      request: request(),
      params: {},
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
    // The top-level mirror that `query.server.ts`'s raw SQL also projects (see
    // the comment above) must be cleared too, not just `custodian.name`.
    expect(body.assets[0].custody[0].name).toBe("");
  });

  it("drops view-scoped params that do not apply to an asset list", async () => {
    await loader({
      context,
      request: request("view=models&modelSortBy=value&page=3"),
      params: {},
    } as never);

    const { filters } = queryArgs();
    expect(filters).not.toContain("view=");
    expect(filters).not.toContain("modelSortBy=");
    // A page number counted in models would page a list of assets.
    expect(filters).not.toContain("page=");
  });

  it("counts the model-less assets unfiltered when nothing matched, individually tracked only", async () => {
    vitest.mocked(db.asset.count).mockResolvedValue(9 as never);

    const response = (await loader({
      context,
      request: request("status=is:AVAILABLE"),
      params: {},
    } as never)) as unknown as Response;

    expect(unfilteredCountWhere()).toEqual({
      // From `requirePermission`, never from the request.
      organizationId: "org-1",
      // Every quantity-tracked asset has no model, and none of them appears in
      // this view, so counting them would describe a set the sheet never lists.
      type: "INDIVIDUAL",
      assetModelId: null,
      // The default Active view hides archived assets (issue #382).
      archivedAt: null,
    });

    const body = (await response.json()) as { unfilteredAssets: number | null };
    expect(body.unfilteredAssets).toBe(9);
  });

  it("passes the viewer's timezone so date filters truncate the same day as the row's count", async () => {
    await loader({ context, request: request(), params: {} } as never);

    // Omitting it falls through to the query helper's UTC default, which
    // truncates a different calendar day than the model row's count does.
    expect(queryArgs().timeZone).toBe("Asia/Tokyo");
  });
});
