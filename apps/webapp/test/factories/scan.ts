import type { Qr, Scan, User, UserOrganization } from "@prisma/client";

import type { ScanWithRelations } from "~/modules/scan/utils.server";

/** Fixed timestamp so snapshots and date assertions stay deterministic. */
const SCAN_AT = new Date("2026-08-12T13:10:00.000Z");

/**
 * Factory for a `Scan` row carrying the relations `parseScanData` reads.
 *
 * Defaults to an anonymous companion-app scan with coordinates — the shape
 * the mobile QR resolve route writes — so callers override only what their
 * assertion is about (e.g. `userAgent`, or a `user` to test attribution).
 *
 * @param overrides - partial scan fields, including `user` and `qr` relations
 * @returns a fully typed scan; a schema change breaks this at compile time
 */
export function createScanWithRelations(
  overrides: Partial<ScanWithRelations> = {}
): ScanWithRelations {
  return {
    id: "scan-1",
    latitude: "51.97956847999077",
    longitude: "5.981302259884078",
    userAgent: "ShelfCompanion/1.3.0 (iPhone; iOS 18.6)",
    userId: "user-1",
    qrId: "qr-1",
    rawQrId: "qr-1",
    manuallyGenerated: false,
    createdAt: SCAN_AT,
    updatedAt: SCAN_AT,
    user: null,
    qr: null,
    ...overrides,
  };
}

/**
 * Builds the `user` relation for a scan, including the org memberships
 * `parseScanData` checks before naming the scanner.
 *
 * @param overrides - partial user fields; pass `userOrganizations` to control
 * whether the viewer's organization matches the QR's
 */
export function createScanUser(
  overrides: Partial<
    User & { userOrganizations: UserOrganization[] | null }
  > = {}
): User & { userOrganizations: UserOrganization[] | null } {
  return {
    ...({
      id: "user-1",
      email: "scanner@example.com",
      username: "scanner",
      firstName: "Scanner",
      lastName: "User",
    } as User),
    userOrganizations: null,
    ...overrides,
  };
}

/**
 * Builds the `qr` relation for a scan.
 *
 * @param overrides - partial QR fields; `organizationId` decides whether the
 * scanning user counts as a member for display purposes
 */
export function createScanQr(overrides: Partial<Qr> = {}): Qr {
  return {
    ...({ id: "qr-1", organizationId: "org-1" } as Qr),
    ...overrides,
  };
}
