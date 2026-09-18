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
vitest.mock("~/utils/roles.server", () => ({
  requirePermission: vitest.fn(),
}));
vitest.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vitest.fn(),
}));
vitest.mock("~/modules/asset/service.server", () => ({
  getAdvancedPaginatedAndFilterableAssets: vitest.fn(),
}));
vitest.mock("~/database/db.server", () => ({
  db: { assetModel: { findFirst: vitest.fn() } },
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

describe("asset model assets endpoint", () => {
  beforeEach(() => {
    // Call history, not just return values: every assertion below reads
    // `.mock.calls[0]`, which without this returns the FIRST test's call for
    // the whole file rather than the current test's.
    vitest.clearAllMocks();

    vitest.mocked(resolveUserFormatPrefsById).mockResolvedValue({
      timeZone: "Asia/Tokyo",
    } as never);

    vitest.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "ADMIN",
      canUseBarcodes: false,
      // Restricted-by-default: `baseUserCanSeeCustody` /
      // `selfServiceCanSeeCustody` both default to `false` in production, so
      // the redaction test below exercises the common case, not an edge one.
      canSeeAllCustody: false,
    } as never);
    vitest.mocked(getAssetIndexSettings).mockResolvedValue({
      mode: "ADVANCED",
      columns: [],
    } as never);
    vitest.mocked(db.assetModel.findFirst).mockResolvedValue({
      id: "am-1",
      name: "MacBook Pro 16",
    } as never);
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

    await expect(
      loader({
        context,
        request: request("https://x.test/api/asset-models/am-1/assets"),
        params: { assetModelId: "am-1" },
      } as never)
    ).rejects.toBeTruthy();
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
    vitest.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      role: "SELF_SERVICE",
      canUseBarcodes: false,
      canSeeAllCustody: false,
    } as never);

    await loader({
      context,
      request: request("https://x.test/api/asset-models/am-1/assets"),
      params: { assetModelId: "am-1" },
    } as never);

    const [args] = vitest.mocked(getAdvancedPaginatedAndFilterableAssets).mock
      .calls[0];
    expect(args.availableToBookOnly).toBe(true);
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
