/**
 * The bulk release-custody endpoint, from the per-unit angle.
 *
 * It splits one submission into a per-unit path and a whole-asset path on the
 * presence of a `quantities` entry, and each `releaseQuantity` call commits
 * its own transaction. These pin the split and, more importantly, that a
 * refusal happens before anything is written.
 *
 * The role angle lives in `assets.bulk-release-custody.test.ts` beside this
 * file. That suite covers which selections the route's own self-service guard
 * judges, which deliberately excludes quantity-tracked rows.
 *
 * @see {@link file://./../../../app/routes/api+/assets.bulk-release-custody.ts}
 */

import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bulkCheckInAssets,
  releaseQuantity,
} from "~/modules/asset/service.server";
import { action } from "~/routes/api+/assets.bulk-release-custody";
import { requirePermission } from "~/utils/roles.server";

// why: mocking Remix's data() so the action returns a real Response
const createDataMock = vi.hoisted(
  () => () =>
    vi.fn(
      (data: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(data), {
          status: init?.status || 200,
          headers: {
            "Content-Type": "application/json",
            ...(init?.headers || {}),
          },
        })
    )
);

vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, data: createDataMock() };
});

// why: the route resolves holders straight off the custody table; these tests
// are about which holders it finds, not about reaching a database.
const dbMocks = vi.hoisted(() => ({ custodyFindMany: vi.fn() }));

vi.mock("~/database/db.server", () => ({
  db: { custody: { findMany: dbMocks.custodyFindMany } },
}));

// why: exercising the route's split, not the custody writes themselves
vi.mock("~/modules/asset/service.server", () => ({
  bulkCheckInAssets: vi.fn().mockResolvedValue({ skippedQuantityTracked: 0 }),
  releaseQuantity: vi.fn().mockResolvedValue({}),
}));

// why: authorization is asserted at the service layer; here it only needs to resolve
vi.mock("~/utils/roles.server", () => ({ requirePermission: vi.fn() }));

// why: the select-all custodian narrowing has its own suite
vi.mock("~/modules/team-member/service.server", () => ({
  scopeCustodianFilterIds: vi.fn().mockResolvedValue([]),
}));

// why: index settings and timezone are forwarded to the bulk call, not under test
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: the route reads the acting user's timezone to forward to the bulk call
// (select-all date filters truncate in it). Stub it so this suite needs no
// db.user lookup.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

// why: preventing actual notification sending during route tests
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

// why: controlling form parsing so each test states its own payload plainly
vi.mock("~/utils/http.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/http.server")>();
  return {
    ...actual,
    assertIsPost: vi.fn(),
    parseData: vi.fn().mockImplementation((formData) => ({
      assetIds: JSON.parse(formData.get("assetIds") || "[]"),
      currentSearchParams: formData.get("currentSearchParams") || null,
      // `AssetQuantitiesSchema` is `.optional().default("{}")`, so the real
      // parse never yields `undefined` here.
      quantities: JSON.parse(formData.get("quantities") || "{}"),
    })),
  };
});

const requirePermissionMock = vi.mocked(requirePermission);
const mockReleaseQuantity = vi.mocked(releaseQuantity);

function makeRequest(assetIds: string[], quantities: Record<string, number>) {
  const formData = new FormData();
  formData.set("assetIds", JSON.stringify(assetIds));
  formData.set("quantities", JSON.stringify(quantities));
  formData.set("currentSearchParams", "");

  return {
    context: { getSession: () => ({ userId: "user-123" }) },
    request: new Request(
      "https://example.com/api/assets/bulk-release-custody",
      {
        method: "POST",
        body: formData,
      }
    ),
    params: {},
  } as unknown as ActionFunctionArgs;
}

/** A resolved operator custody row as the route selects it. */
function holder(
  assetId: string,
  teamMemberId: string,
  {
    title = "USB-C Cables",
    quantity = 50,
  }: { title?: string; quantity?: number } = {}
) {
  return { assetId, teamMemberId, quantity, asset: { title } };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({
    organizationId: "org-1",
    role: OrganizationRoles.ADMIN,
    canUseBarcodes: false,
    canSeeAllCustody: true,
  } as Awaited<ReturnType<typeof requirePermission>>);
});

describe("api/assets/bulk-release-custody", () => {
  it("releases a named quantity from the asset's single holder", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([holder("asset-qty", "tm-1")]);

    await action(makeRequest(["asset-qty"], { "asset-qty": 4 }));

    expect(mockReleaseQuantity).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: "asset-qty",
        teamMemberId: "tm-1",
        quantity: 4,
        organizationId: "org-1",
      })
    );
    // Every id carried a quantity, so the bulk call would have been handed an
    // empty list and tripped its own "all quantity-tracked" refusal.
    expect(bulkCheckInAssets).not.toHaveBeenCalled();
  });

  it("leaves assets without a quantity on the bulk path", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([holder("asset-qty", "tm-1")]);

    await action(makeRequest(["asset-qty", "asset-plain"], { "asset-qty": 2 }));

    expect(bulkCheckInAssets).toHaveBeenCalledWith(
      expect.objectContaining({ assetIds: ["asset-plain"] })
    );
  });

  it("writes nothing when an asset has no operator-held units", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([holder("asset-ok", "tm-1")]);

    const response = (await action(
      makeRequest(["asset-ok", "asset-unheld"], {
        "asset-ok": 1,
        "asset-unheld": 1,
      })
    )) as unknown as Response;

    // The refusal must land before the first release: each one commits its own
    // transaction, so resolving inside the write loop would leave `asset-ok`
    // released while the drawer reports the submission failed.
    expect(response.status).toBe(400);
    expect(mockReleaseQuantity).not.toHaveBeenCalled();
  });

  it("refuses by name when an asset is held by more than one person", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([
      holder("asset-shared", "tm-1", { title: "Drill Bits" }),
      holder("asset-shared", "tm-2", { title: "Drill Bits" }),
    ]);

    const response = (await action(
      makeRequest(["asset-shared"], { "asset-shared": 1 })
    )) as unknown as Response;
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Drill Bits");
    expect(body.error.message).toContain("held by more than one person");
    expect(mockReleaseQuantity).not.toHaveBeenCalled();
  });

  it("writes nothing when one asset asks for more units than its holder has", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([
      holder("asset-ok", "tm-1", { quantity: 50 }),
      holder("asset-short", "tm-2", { title: "Drill Bits", quantity: 2 }),
    ]);

    const response = (await action(
      makeRequest(["asset-ok", "asset-short"], {
        "asset-ok": 1,
        "asset-short": 5,
      })
    )) as unknown as Response;
    const body = await response.json();

    // `releaseQuantity` checks this too, but inside the asset's own
    // transaction. By then `asset-ok` would already be committed, and a retry
    // would release it a second time.
    expect(response.status).toBe(400);
    expect(body.error.message).toContain("Drill Bits");
    expect(body.error.message).toContain("only 2 unit(s)");
    expect(mockReleaseQuantity).not.toHaveBeenCalled();
  });

  it("releases once for an asset scanned under two codes", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([holder("asset-qty", "tm-1")]);

    // The scanner keys rows by code, so one asset scanned by QR and by barcode
    // arrives twice. Releasing per occurrence would hand back double.
    await action(makeRequest(["asset-qty", "asset-qty"], { "asset-qty": 4 }));

    expect(mockReleaseQuantity).toHaveBeenCalledTimes(1);
    expect(mockReleaseQuantity).toHaveBeenCalledWith(
      expect.objectContaining({ assetId: "asset-qty", quantity: 4 })
    );
  });

  it("considers only operator-assigned custody rows as holders", async () => {
    dbMocks.custodyFindMany.mockResolvedValue([holder("asset-qty", "tm-1")]);

    await action(makeRequest(["asset-qty"], { "asset-qty": 1 }));

    // Kit-inherited rows go back by releasing the kit, which cascade-deletes
    // them; counting one here would make a single-holder asset look shared.
    expect(dbMocks.custodyFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ kitCustodyId: null }),
      })
    );
  });
});
