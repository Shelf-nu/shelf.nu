import type { ScanWithRelations } from "~/modules/scan/utils.server";

/** Fixed timestamp so date assertions stay deterministic. */
const SCAN_AT = new Date("2026-08-12T13:10:00.000Z");

/**
 * Factory for a `Scan` row carrying the relations `parseScanData` reads.
 *
 * Defaults to an anonymous companion-app scan with coordinates — the shape
 * the mobile QR resolve route writes — so callers override only what their
 * assertion is about (e.g. `userAgent`).
 *
 * The `user` and `qr` relations default to `null` and have no helper of their
 * own on purpose: building them would mean either listing every required
 * Prisma column or casting, and casting is exactly what this factory exists
 * to avoid. A test that needs them should pass fully-typed objects, so a
 * schema change fails the build rather than the assertion.
 *
 * @param overrides - partial scan fields, including the `user` and `qr` relations
 * @returns a fully typed scan; a `Scan` schema change breaks this at compile time
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
