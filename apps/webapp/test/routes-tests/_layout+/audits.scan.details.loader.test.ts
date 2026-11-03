/**
 * Tests for the scan details loader's photo data.
 *
 * Every photo caption on the page reads the photo's capture fields and, for
 * the "Old photo" check, its audit's start. A select that drops one renders
 * every new photo as "No date", or stops the check, with nothing failing.
 *
 * @see {@link file://../../../app/routes/_layout+/audits.$auditId.scan.$auditAssetId.details.tsx}
 * @see {@link file://../../../app/components/audit/audit-photo.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessFor } from "@helpers/role-access";

// @vitest-environment node

// why: external auth and permission lookup; this suite is about what the
// loader asks the database for.
vi.mock("~/utils/roles.server", () => ({
  requirePermission: vi.fn(),
}));

// why: the assignee guard is unit-tested in service.server.test.ts.
vi.mock("~/modules/audit/service.server", async (importOriginal) => {
  const actual = await importOriginal<typeof AuditService>();
  return { ...actual, requireAuditAssigneeForScopedViewer: vi.fn() };
});

// why: external database; each read returns a minimal row so the loader runs
// to the end and its queries can be inspected.
vi.mock("~/database/db.server", () => ({
  db: {
    auditAsset: { findFirst: vi.fn() },
    auditNote: { findMany: vi.fn() },
    auditImage: { findMany: vi.fn() },
  },
}));

import type * as AuditService from "~/modules/audit/service.server";
import { db } from "~/database/db.server";
import { loader } from "~/routes/_layout+/audits.$auditId.scan.$auditAssetId.details";
import { requirePermission } from "~/utils/roles.server";

describe("audits.$auditId.scan.$auditAssetId.details loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({
      organizationId: "org-1",
      access: accessFor([OrganizationRoles.ADMIN]),
    } as never);
    vi.mocked(db.auditAsset.findFirst).mockResolvedValue({
      id: "audit-asset-1",
      scannedAt: new Date("2026-10-21T09:10:00Z"),
      asset: { id: "asset-1", title: "Camera" },
      auditSession: { status: "ACTIVE", startedAt: null, assignments: [] },
    } as never);
    vi.mocked(db.auditNote.findMany).mockResolvedValue([]);
    vi.mocked(db.auditImage.findMany).mockResolvedValue([]);
  });

  it("asks for every field the photo captions read", async () => {
    await loader({
      request: new Request(
        "http://localhost/audits/audit-1/scan/audit-asset-1/details"
      ),
      params: { auditId: "audit-1", auditAssetId: "audit-asset-1" },
      context: { getSession: () => ({ userId: "user-1" }) },
    } as unknown as Parameters<typeof loader>[0]);

    const imageQuery = vi.mocked(db.auditImage.findMany).mock.calls[0][0];
    expect(imageQuery?.select).toEqual(
      expect.objectContaining({
        capturedAt: true,
        captureSource: true,
        createdAt: true,
      })
    );

    const assetQuery = vi.mocked(db.auditAsset.findFirst).mock.calls[0][0];
    expect(assetQuery?.include?.auditSession).toEqual(
      expect.objectContaining({
        select: expect.objectContaining({ startedAt: true }),
      })
    );
  });
});
