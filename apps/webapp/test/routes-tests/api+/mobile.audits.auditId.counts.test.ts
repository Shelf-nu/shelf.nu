/**
 * The mobile audit detail carries the unit counts of quantity-tracked rows.
 *
 * The phone asks for a count when it scans a row whose `expectedQuantity` is
 * set, and shows "8 of 14 pcs" from these fields. A row without them is treated
 * as an individual asset, so a dropped field silently turns counting off.
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

// why: the archive stamps come from one asset read; none are archived here
vi.mock("~/database/db.server", () => ({
  db: { asset: { findMany: vi.fn(async () => []) } },
}));

import { getMobileUserContext } from "~/modules/api/mobile-auth.server";
import {
  getAuditScans,
  getAuditSessionDetails,
} from "~/modules/audit/service.server";
import { loader } from "~/routes/api+/mobile+/audits.$auditId";

beforeEach(() => {
  vi.mocked(getMobileUserContext).mockResolvedValue(
    mobileUserContext({ roles: ["ADMIN"] }) as never
  );
  vi.mocked(getAuditSessionDetails).mockResolvedValue({
    session: {
      id: "audit-1",
      name: "Sandbag check",
      description: null,
      status: "ACTIVE",
      expectedAssetCount: 1,
      foundAssetCount: 1,
      missingAssetCount: 0,
      unexpectedAssetCount: 0,
      dueDate: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date("2026-11-04T00:00:00.000Z"),
      createdBy: null,
      assignments: [],
    },
    expectedAssets: [
      {
        id: "pool-1",
        name: "Sandbag",
        auditAssetId: "aa-pool-1",
        expectedQuantity: 14,
        foundQuantity: 8,
        unitOfMeasure: "pcs",
        mainImage: null,
        thumbnailImage: null,
        locationName: null,
        categoryName: null,
        custodianName: null,
      },
    ],
  } as never);
  vi.mocked(getAuditScans).mockResolvedValue([
    {
      id: "scan-1",
      code: "qr-1",
      assetId: "pool-1",
      assetTitle: "Sandbag",
      isExpected: true,
      scannedAt: new Date("2026-11-04T10:00:00.000Z"),
      auditAssetId: "aa-pool-1",
      assetLocationName: null,
      assetDeleted: false,
      auditNotesCount: 0,
      auditImagesCount: 0,
      expectedQuantity: 14,
      foundQuantity: 8,
      unitOfMeasure: "pcs",
    },
  ] as never);
});

async function load() {
  const response = (await loader({
    request: new Request(
      "http://localhost/api/mobile/audits/audit-1?orgId=org-1",
      { headers: { Authorization: "Bearer t" } }
    ),
    params: { auditId: "audit-1" },
    context: {},
  } as never)) as unknown as {
    data: {
      expectedAssets: Record<string, unknown>[];
      existingScans: Record<string, unknown>[];
    };
  };
  return response.data;
}

describe("GET /api/mobile/audits/:auditId unit counts", () => {
  it("sends the counts and unit on each expected asset", async () => {
    const body = await load();

    expect(body.expectedAssets[0]).toMatchObject({
      expectedQuantity: 14,
      foundQuantity: 8,
      unitOfMeasure: "pcs",
    });
  });

  it("sends the counts and unit on each scan", async () => {
    const body = await load();

    expect(body.existingScans[0]).toMatchObject({
      expectedQuantity: 14,
      foundQuantity: 8,
      unitOfMeasure: "pcs",
    });
  });
});
