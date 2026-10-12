/**
 * The mobile audit detail says which of the audit's assets are archived.
 *
 * An audit keeps the assets it was created with, and one of them can be
 * archived afterwards. The app badges those rows "Archived", which it can only
 * do if every expected asset and every scan carries the archive stamp.
 *
 * @see {@link file://../../../app/routes/api+/mobile+/audits.$auditId.ts}
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mobileUserContext } from "@helpers/mobile-user-context";

// @vitest-environment node

// why: token auth needs Supabase; this suite is about the response shape
vi.mock("~/modules/api/mobile-auth.server", () => ({
  requireMobileAuth: vi.fn(async () => ({ user: { id: "caller" } })),
  requireOrganizationAccess: vi.fn(async () => "org-1"),
  requireMobilePermission: vi.fn(async () => undefined),
  getMobileUserContext: vi.fn(),
}));

// why: the audit reads are database work; they return a fixed audit here
vi.mock("~/modules/audit/service.server", () => ({
  getAuditSessionDetails: vi.fn(),
  getAuditScans: vi.fn(),
  requireAuditAssignee: vi.fn(async () => undefined),
}));

// why: the archive stamps come from one asset read keyed on the audit's ids
vi.mock("~/database/db.server", () => ({
  db: { asset: { findMany: vi.fn() } },
}));

import { db } from "~/database/db.server";
import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import {
  getAuditScans,
  getAuditSessionDetails,
} from "~/modules/audit/service.server";
import { loader } from "~/routes/api+/mobile+/audits.$auditId";

const ARCHIVED_AT = new Date("2026-10-09T13:44:00.000Z");

/** An expected asset row as the audit service returns it. */
const expected = (id: string) => ({
  id,
  name: id,
  auditAssetId: `aa-${id}`,
  mainImage: null,
  thumbnailImage: null,
  locationName: null,
  categoryName: null,
  custodianName: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: ["ADMIN"] }) as never
  );
  vi.mocked(getAuditSessionDetails).mockResolvedValue({
    session: {
      id: "audit-1",
      name: "Shelf check",
      description: null,
      status: "ACTIVE",
      expectedAssetCount: 2,
      foundAssetCount: 1,
      missingAssetCount: 0,
      unexpectedAssetCount: 0,
      dueDate: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date("2026-10-01T00:00:00.000Z"),
      createdBy: null,
      assignments: [],
    },
    expectedAssets: [expected("asset-active"), expected("asset-archived")],
  } as never);
  vi.mocked(getAuditScans).mockResolvedValue([
    {
      id: "scan-1",
      code: "qr-1",
      assetId: "asset-archived",
      assetTitle: "asset-archived",
      isExpected: true,
      scannedAt: new Date("2026-10-02T00:00:00.000Z"),
      auditAssetId: "aa-asset-archived",
      assetLocationName: null,
      assetDeleted: false,
      auditNotesCount: 0,
      auditImagesCount: 0,
    },
  ] as never);
  vi.mocked(db.asset.findMany).mockResolvedValue([
    { id: "asset-archived", archivedAt: ARCHIVED_AT },
  ] as never);
});

async function load() {
  const response = (await loader({
    request: new Request(
      "http://localhost/api/mobile/audits/audit-1?orgId=org-1",
      {
        headers: { Authorization: "Bearer t" },
      }
    ),
    params: { auditId: "audit-1" },
    context: {},
  } as never)) as unknown as {
    data: {
      expectedAssets: { id: string; archivedAt: string | null }[];
      existingScans: { assetId: string; archivedAt: string | null }[];
    };
  };
  return response.data;
}

describe("GET /api/mobile/audits/:auditId archive stamps", () => {
  it("stamps the archived expected asset and leaves the active one null", async () => {
    const body = await load();

    expect(body.expectedAssets.map((a) => [a.id, a.archivedAt])).toEqual([
      ["asset-active", null],
      ["asset-archived", ARCHIVED_AT.toISOString()],
    ]);
  });

  it("stamps a scan of an archived asset", async () => {
    const body = await load();

    expect(body.existingScans.map((s) => [s.assetId, s.archivedAt])).toEqual([
      ["asset-archived", ARCHIVED_AT.toISOString()],
    ]);
  });

  it("reads the stamps once, org-scoped, for the audit's own assets", async () => {
    await load();

    expect(db.asset.findMany).toHaveBeenCalledTimes(1);
    expect(db.asset.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["asset-active", "asset-archived"] },
        organizationId: "org-1",
        archivedAt: { not: null },
      },
      select: { id: true, archivedAt: true },
    });
  });
});
