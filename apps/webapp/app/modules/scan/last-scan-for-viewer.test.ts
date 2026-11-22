// @vitest-environment node
/**
 * Tests for `getLastScanForViewer`: the `scan:read` gate, the read by asset
 * or kit, and the fallback to the newest located scan for the card's map.
 *
 * The parsed payload carries the scanner's display name and EMAIL, the scan's
 * GPS COORDINATES and the device user-agent. BASE and SELF_SERVICE hold
 * `scan: []`, so for them it must never be read, let alone returned: hiding
 * `<ScanDetails>` in React would leave it in the page payload.
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

/** A scan row shaped as `getLastScanForTarget` returns it, carrying real PII. */
const scanRow = {
  id: "scan-1",
  userId: "user-9",
  latitude: "52.3676",
  longitude: "4.9041",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
  manuallyGenerated: false,
  codeType: "BARCODE",
  code: "BC-0042",
  organizationId: "org-1",
  createdAt: new Date("2026-07-01T10:00:00Z"),
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
    target: { assetId: "asset-1" },
    userId: "user-1",
    organizationId: "org-1",
    roles,
    workspace: null,
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
          scannedBy: "Dana Reeves (dana@example.com)",
          coordinates: "52.3676, 4.9041",
        })
      );
    }
  );

  it("reads the latest scan of the asset, whichever code was scanned", async () => {
    const result = await getLastScanForViewer(args([OrganizationRoles.OWNER]));

    expect(scanFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assetId: "asset-1", organizationId: "org-1" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
    // A barcode scan has no QR; the card still names the code.
    expect(result).toMatchObject({ codeType: "BARCODE", code: "BC-0042" });
  });

  it("reads a kit's last scan by the kit", async () => {
    await getLastScanForViewer({
      ...args([OrganizationRoles.ADMIN]),
      target: { kitId: "kit-1" },
    });

    expect(scanFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kitId: "kit-1", organizationId: "org-1" },
      })
    );
  });

  it("reads no second row when the last scan has a location", async () => {
    await getLastScanForViewer(args([OrganizationRoles.OWNER]));

    expect(scanFindFirst).toHaveBeenCalledTimes(1);
  });

  it("places a scan with no location at the newest located scan of the asset", async () => {
    const located = {
      latitude: "48.8566",
      longitude: "2.3522",
      createdAt: new Date("2026-06-01T08:00:00Z"),
    };
    scanFindFirst
      .mockResolvedValueOnce({ ...scanRow, latitude: null, longitude: null })
      .mockResolvedValueOnce(located);

    const result = await getLastScanForViewer(args([OrganizationRoles.OWNER]));

    expect(scanFindFirst).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          assetId: "asset-1",
          organizationId: "org-1",
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    );
    expect(result).toMatchObject({
      coordinates: "48.8566, 2.3522",
      locatedAt: located.createdAt,
      dateTime: scanRow.createdAt,
    });
  });

  it("returns null when the asset has never been scanned", async () => {
    scanFindFirst.mockResolvedValue(null);

    const result = await getLastScanForViewer(args([OrganizationRoles.OWNER]));

    // Same shape an unauthorized viewer gets, so callers need no special case.
    expect(result).toBeNull();
  });
});
