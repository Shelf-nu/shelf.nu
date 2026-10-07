/**
 * The three assign-custody endpoints that share `bulkCheckOutAssets` refuse an
 * individually tracked kit member.
 *
 * Custody of a kit member comes from its kit: assign custody to the kit, or
 * take the asset out of the kit first. The rule is enforced once, inside
 * `bulkCheckOutAssets`, and these tests prove each endpoint reaches it. That is
 * why the service is NOT mocked here, unlike in each route's own suite: a
 * mocked service would pass whether or not the guard runs. The database is
 * faked one level down, so the route, the service and the guard all run for
 * real.
 *
 * Endpoints covered:
 * - `POST /api/assets/bulk-assign-custody` (web assets index bulk action)
 * - `POST /api/mobile/custody/assign` (companion asset screen)
 * - `POST /api/mobile/bulk-assign-custody` (companion bulk + scan tab)
 *
 * The web single-asset page has its own transaction and is covered in
 * `assets.$assetId.overview.assign-custody.test.tsx`.
 *
 * @see {@link file://./../../../app/modules/custody/service.server.ts} assertNotKitMembers
 * @see {@link file://./../../../app/modules/asset/service.server.ts} bulkCheckOutAssets
 */
import { OrganizationRoles } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { action as webBulkAssign } from "~/routes/api+/assets.bulk-assign-custody";
import { action as mobileBulkAssign } from "~/routes/api+/mobile+/bulk-assign-custody";
import { action as mobileAssign } from "~/routes/api+/mobile+/custody.assign";
import { requirePermission } from "~/utils/roles.server";

// @vitest-environment node

const KIT_MEMBER_MESSAGE =
  '"Tripod" is part of kit "Camera Kit". Assign custody to the kit, or remove the asset from the kit first.';

// why: React Router's data() is replaced so every action returns a real
// Response whose status and body the tests can read.
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return {
    ...actual,
    data: vi.fn(
      (body: unknown, init?: ResponseInit) =>
        new Response(JSON.stringify(body), {
          status: init?.status || 200,
          headers: { "Content-Type": "application/json" },
        })
    ),
  };
});

/**
 * The rows the real `bulkCheckOutAssets` reads and writes. The service, the
 * custody guards and the org check run unmocked against these.
 */
const dbMocks = vi.hoisted(() => ({
  assetFindMany: vi.fn(),
  assetUpdateMany: vi.fn(),
  assetKitFindMany: vi.fn(),
  teamMemberFindFirst: vi.fn(),
  custodyDeleteMany: vi.fn(),
  custodyFindFirst: vi.fn(),
  custodyCreateMany: vi.fn(),
  noteCreateMany: vi.fn(),
}));

// why: the database is the boundary under the service; faking it here lets the
// route, `bulkCheckOutAssets` and its guards run for real. The transaction runs
// its callback against the same fake.
vi.mock("~/database/db.server", () => {
  const db = {
    asset: {
      findMany: dbMocks.assetFindMany,
      updateMany: dbMocks.assetUpdateMany,
    },
    assetKit: { findMany: dbMocks.assetKitFindMany },
    teamMember: { findFirst: dbMocks.teamMemberFindFirst },
    custody: {
      deleteMany: dbMocks.custodyDeleteMany,
      findFirst: dbMocks.custodyFindFirst,
      createMany: dbMocks.custodyCreateMany,
    },
    note: { createMany: dbMocks.noteCreateMany },
    // The guard's `SELECT ... FOR UPDATE` on the asset rows.
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(db)),
  };
  return { db };
});

// why: web authorization is its own concern; these tests start from an
// authorized admin.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: mobile authentication talks to Supabase; these tests start from an
// authenticated admin.
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn().mockResolvedValue({ user: { id: "user-1" } }),
  requireOrganizationAccess: vi.fn().mockResolvedValue("org-1"),
  requireMobilePermission: vi.fn().mockResolvedValue(undefined),
  getMobileUserContext: vi.fn().mockResolvedValue({
    role: OrganizationRoles.ADMIN,
    canUseBarcodes: false,
    canSeeAllCustody: true,
  }),
}));

// why: the rate limiter keeps in-process counters across tests.
vi.mock("~/utils/rate-limit.server", () => ({
  enforceUserRateLimit: vi.fn().mockResolvedValue(undefined),
}));

// why: index settings only matter for "select all", which these tests do not
// use.
vi.mock("~/modules/asset-index-settings/service.server", () => ({
  getAssetIndexSettings: vi.fn().mockResolvedValue({ mode: "SIMPLE" }),
}));

// why: the routes' custodian lookup and the select-all custodian narrowing
// have their own suites; here they only need to return the custodian.
vi.mock("~/modules/team-member/service.server", () => ({
  getTeamMember: vi.fn().mockResolvedValue({
    id: "custodian-1",
    name: "Jane Doe",
    user: null,
  }),
  scopeCustodianFilterIds: vi.fn().mockResolvedValue([]),
}));

// why: the acting user is read for the audit note; its content is pinned in
// the asset service suite.
vi.mock("~/modules/user/service.server", () => ({
  getUserByID: vi.fn().mockResolvedValue({
    id: "user-1",
    firstName: "Ada",
    lastName: "Lovelace",
    displayName: null,
  }),
}));

// why: the web route reads the user's timezone for select-all date filters,
// which these tests do not use.
vi.mock("~/utils/date-format.server", () => ({
  resolveUserFormatPrefsById: vi.fn().mockResolvedValue({ timeZone: "UTC" }),
}));

// why: activity events are written through their own module and pinned in its
// suite.
vi.mock("~/modules/activity-event/service.server", () => ({
  recordEvent: vi.fn().mockResolvedValue(undefined),
  recordEvents: vi.fn().mockResolvedValue(undefined),
}));

// why: the web route sends a toast on success; nothing is listening here.
vi.mock("~/utils/emitter/send-notification.server", () => ({
  sendNotification: vi.fn(),
}));

/** An available, individually tracked asset as `bulkCheckOutAssets` reads it. */
function availableAsset(id: string, title: string) {
  return { id, title, status: "AVAILABLE", type: "INDIVIDUAL" };
}

/** Calls an endpoint and returns its status and parsed body. */
async function call(
  run: (args: ActionFunctionArgs) => Promise<unknown>,
  request: Request
) {
  const response = (await run({
    context: { getSession: () => ({ userId: "user-1" }) },
    request,
    params: {},
  } as unknown as ActionFunctionArgs)) as Response;
  return { status: response.status, body: await response.json() };
}

/** The three endpoints, each given one asset id. */
const ENDPOINTS = [
  {
    name: "web bulk (POST /api/assets/bulk-assign-custody)",
    send: (assetId: string) => {
      const form = new FormData();
      form.append("assetIds[0]", assetId);
      form.append(
        "custodian",
        JSON.stringify({ id: "custodian-1", name: "Jane Doe" })
      );
      return call(
        webBulkAssign,
        new Request("http://localhost/api/assets/bulk-assign-custody", {
          method: "POST",
          body: form,
        })
      );
    },
  },
  {
    name: "mobile single (POST /api/mobile/custody/assign)",
    send: (assetId: string) =>
      call(
        mobileAssign,
        new Request("http://localhost/api/mobile/custody/assign?orgId=org-1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assetId, custodianId: "custodian-1" }),
        })
      ),
  },
  {
    name: "mobile bulk (POST /api/mobile/bulk-assign-custody)",
    send: (assetId: string) =>
      call(
        mobileBulkAssign,
        new Request(
          "http://localhost/api/mobile/bulk-assign-custody?orgId=org-1",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              assetIds: [assetId],
              custodianId: "custodian-1",
            }),
          }
        )
      ),
  },
];

beforeEach(() => {
  vi.clearAllMocks();

  vi.mocked(requirePermission).mockResolvedValue({
    organizationId: "org-1",
    role: OrganizationRoles.ADMIN,
    canUseBarcodes: false,
    canSeeAllCustody: true,
  } as Awaited<ReturnType<typeof requirePermission>>);

  // `mockResolvedValue`, not `...Once`, so a value one test sets can never be
  // left queued for the next test's read.
  dbMocks.assetKitFindMany.mockResolvedValue([]);
  dbMocks.teamMemberFindFirst.mockResolvedValue({
    id: "custodian-1",
    name: "Jane Doe",
    user: null,
  });
  dbMocks.custodyFindFirst.mockResolvedValue(null);
  dbMocks.custodyDeleteMany.mockResolvedValue({ count: 0 });
  dbMocks.custodyCreateMany.mockResolvedValue({ count: 1 });
  dbMocks.assetUpdateMany.mockResolvedValue({ count: 1 });
  dbMocks.noteCreateMany.mockResolvedValue({ count: 1 });
});

describe.each(ENDPOINTS)("$name", ({ send }) => {
  it("refuses an individually tracked kit member with 400 and names its kit", async () => {
    dbMocks.assetFindMany.mockResolvedValue([
      availableAsset("asset-tripod", "Tripod"),
    ]);
    dbMocks.assetKitFindMany.mockResolvedValue([
      {
        asset: { id: "asset-tripod", title: "Tripod" },
        kit: { id: "kit-camera", name: "Camera Kit" },
      },
    ]);

    const { status, body } = await send("asset-tripod");

    expect(status).toBe(400);
    expect(body.error.message).toBe(KIT_MEMBER_MESSAGE);
    // Nothing was written: no custody row, no status flip.
    expect(dbMocks.custodyCreateMany).not.toHaveBeenCalled();
    expect(dbMocks.assetUpdateMany).not.toHaveBeenCalled();
  });

  it("still assigns an asset that is in no kit", async () => {
    dbMocks.assetFindMany.mockResolvedValue([
      availableAsset("asset-drill", "Drill"),
    ]);

    const { status } = await send("asset-drill");

    expect(status).toBe(200);
    expect(dbMocks.custodyCreateMany).toHaveBeenCalledWith({
      data: [{ assetId: "asset-drill", teamMemberId: "custodian-1" }],
    });
  });
});
