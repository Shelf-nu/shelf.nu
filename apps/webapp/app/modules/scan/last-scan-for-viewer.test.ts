// @vitest-environment node
/**
 * Authorization tests for `getLastScanForViewer`.
 *
 * The asset overview loader used to fetch and return the parsed last scan
 * unconditionally, and the component hid `<ScanDetails>` behind a client-side
 * `scan:read` check. The parsed payload carries the scanner's display name and
 * EMAIL, the scan's GPS COORDINATES and the device user-agent, so for BASE and
 * SELF_SERVICE (both `scan: []`) that was PII sitting in the page payload,
 * hidden only by React.
 *
 * These tests drive the real `Role2PermissionMap` through the real
 * `hasPermission`, so they assert the actual matrix rather than a restatement
 * of it. Only the DB read is mocked.
 *
 * @see {@link file://./service.server.ts}
 */
import { OrganizationRoles } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { scanFindFirst } = vi.hoisted(() => ({ scanFindFirst: vi.fn() }));

// why: the only external dependency. `hasPermission` and `parseScanData` run
// for real so the gate is tested end to end against the live matrix.
vi.mock("~/database/db.server", () => ({
  db: { scan: { findFirst: scanFindFirst } },
}));

import { getLastScanForViewer } from "./service.server";

/** A scan row shaped as `getScanByQrId` returns it, carrying real PII. */
const scanRow = {
  id: "scan-1",
  userId: "user-9",
  latitude: "52.3676",
  longitude: "4.9041",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  manuallyGenerated: false,
  createdAt: new Date("2026-07-01T10:00:00Z"),
  qr: { id: "qr-1", organizationId: "org-1" },
  user: {
    id: "user-9",
    firstName: "Dana",
    lastName: "Reeves",
    displayName: "Dana Reeves",
    email: "dana@example.com",
    userOrganizations: [{ organizationId: "org-1" }],
  },
};

function args(roles: OrganizationRoles[]) {
  return {
    qrId: "qr-1",
    userId: "user-1",
    organizationId: "org-1",
    roles,
  };
}

describe("getLastScanForViewer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scanFindFirst.mockResolvedValue(scanRow);
  });

  it.each([OrganizationRoles.BASE, OrganizationRoles.SELF_SERVICE])(
    "returns null for %s and never reads the scan row",
    async (role) => {
      const result = await getLastScanForViewer(args([role]));

      expect(result).toBeNull();
      // Not merely omitted from the response — never fetched at all.
      expect(scanFindFirst).not.toHaveBeenCalled();
    }
  );

  it.each([OrganizationRoles.ADMIN, OrganizationRoles.OWNER])(
    "returns the parsed scan for %s",
    async (role) => {
      const result = await getLastScanForViewer(args([role]));

      expect(scanFindFirst).toHaveBeenCalledTimes(1);
      expect(result).toEqual(
        expect.objectContaining({
          scannedBy: "Dana Reeves(dana@example.com)",
          coordinates: "52.3676, 4.9041",
        })
      );
    }
  );

  it("returns null without touching the DB when the asset has no QR code", async () => {
    const result = await getLastScanForViewer({
      ...args([OrganizationRoles.OWNER]),
      qrId: undefined,
    });

    expect(result).toBeNull();
    expect(scanFindFirst).not.toHaveBeenCalled();
  });

  it("returns null when the asset has a QR but has never been scanned", async () => {
    scanFindFirst.mockResolvedValue(null);

    const result = await getLastScanForViewer(args([OrganizationRoles.OWNER]));

    // Same shape an unauthorized viewer gets, so callers need no special case.
    expect(result).toBeNull();
  });
});
