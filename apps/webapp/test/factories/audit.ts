/**
 * Factories for audit test data.
 *
 * `AuditAsset` deserves particular care: it carries **no `organizationId`**.
 * It inherits its tenant purely through `auditSession`, so `auditSessionId` is
 * the only field that scopes it — which is why the factory requires one rather
 * than defaulting it silently. A fixture that omits the link models a row that
 * cannot exist, and would let a scoping regression pass unnoticed.
 *
 * @see {@link file://./../../app/modules/audit/service.server.ts}
 */

import type { AuditAsset, AuditSession } from "@prisma/client";
import { AuditAssetStatus, AuditStatus } from "@prisma/client";

/** Default ids, exported so tests can assert against the same constants. */
export const AUDIT_SESSION_ID = "audit-session-1";
export const AUDIT_ORGANIZATION_ID = "org-1";

/**
 * Builds an AuditSession row.
 *
 * Defaults to PENDING — the only status from which assets may be added or
 * removed, so it is the state most removal tests need.
 *
 * @param overrides - Fields to replace on the default row
 */
export function createAuditSession(
  overrides: Partial<AuditSession> = {}
): Partial<AuditSession> {
  return {
    id: AUDIT_SESSION_ID,
    name: "Test Audit",
    description: null,
    status: AuditStatus.PENDING,
    organizationId: AUDIT_ORGANIZATION_ID,
    createdById: "user-1",
    expectedAssetCount: 0,
    foundAssetCount: 0,
    missingAssetCount: 0,
    unexpectedAssetCount: 0,
    startedAt: null,
    dueDate: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

/**
 * Builds an AuditAsset row.
 *
 * `auditSessionId` is REQUIRED, not defaulted. It is the entire tenant
 * boundary for this model, and a fixture that leaves it implicit is exactly
 * the shape that lets an unscoped query look correct in a test.
 *
 * @param args.auditSessionId - The session this row belongs to
 * @param overrides - Fields to replace on the default row
 */
export function createAuditAsset(
  { auditSessionId }: { auditSessionId: string },
  overrides: Partial<AuditAsset> = {}
): Partial<AuditAsset> {
  return {
    id: "audit-asset-1",
    auditSessionId,
    assetId: "asset-1",
    expected: true,
    status: AuditAssetStatus.PENDING,
    scannedById: null,
    scannedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}
