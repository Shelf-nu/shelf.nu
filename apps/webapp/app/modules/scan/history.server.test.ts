// @vitest-environment node
/**
 * Tests for `toScanHistoryRow`: what one row of the scan history sheet shows
 * for a recorded scan. Built on the server, so the client never receives a
 * non-member's email or a raw user agent.
 *
 * @see {@link file://./history.server.ts}
 */
import type { UserOrganization } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createScanWithRelations, createUser } from "@factories";

import { toScanHistoryRow } from "./history.server";

/** A scanning user who belongs to the given workspace. */
function scannerIn(organizationId: string) {
  return {
    ...createUser({
      id: "user-9",
      firstName: "Dana",
      lastName: "Reeves",
      displayName: "Dana Reeves",
      email: "dana@example.com",
    }),
    userOrganizations: [{ organizationId } as UserOrganization],
  };
}

describe("toScanHistoryRow", () => {
  it.each([
    ["QR_LINK", "QR link"],
    ["WEB_SCANNER", "Web scanner"],
    ["WEB_DRAWER", "Scanner list"],
    ["COMPANION", "Companion app"],
    ["AUDIT", "Audit"],
    ["GPS_UPDATE", "GPS update"],
  ] as const)("labels a %s scan as %s", (source, label) => {
    expect(toScanHistoryRow(createScanWithRelations({ source })).source).toBe(
      label
    );
  });

  it("says the source was not recorded for a row written before sources were tracked", () => {
    expect(
      toScanHistoryRow(createScanWithRelations({ source: null })).source
    ).toBe("Not recorded");
  });

  it("names a manual GPS update as what it is, not as a QR scan", () => {
    const row = toScanHistoryRow(
      createScanWithRelations({
        codeType: "QR",
        source: "GPS_UPDATE",
        manuallyGenerated: true,
      })
    );

    expect(row.code).toBe("Manual GPS update");
    expect(row.source).toBe("GPS update");
  });

  it("labels an older manual GPS update, written before sources were tracked, as a GPS update", () => {
    const row = toScanHistoryRow(
      createScanWithRelations({ source: null, manuallyGenerated: true })
    );

    expect(row.source).toBe("GPS update");
  });

  it("names the code: a QR without its id, a barcode or SAM ID with its value", () => {
    expect(
      toScanHistoryRow(
        createScanWithRelations({ codeType: "QR", code: "qr-1" })
      ).code
    ).toBe("QR code");
    expect(
      toScanHistoryRow(
        createScanWithRelations({ codeType: "BARCODE", code: "BC-0042" })
      ).code
    ).toBe("Barcode: BC-0042");
    expect(
      toScanHistoryRow(
        createScanWithRelations({ codeType: "SAM_ID", code: "SAM-0007" })
      ).code
    ).toBe("SAM ID: SAM-0007");
  });

  it("names a member of the scan's workspace", () => {
    const row = toScanHistoryRow(
      createScanWithRelations({
        organizationId: "org-1",
        user: scannerIn("org-1"),
      })
    );

    expect(row.scannedBy).toBe("Dana Reeves");
    expect(row.scannedByEmail).toBe("dana@example.com");
  });

  it("shows a scanner outside the workspace as Unknown, and never their email", () => {
    const row = toScanHistoryRow(
      createScanWithRelations({
        organizationId: "org-1",
        user: scannerIn("org-2"),
      })
    );

    expect(row.scannedBy).toBe("Unknown");
    expect(row.scannedByEmail).toBeNull();
    expect(JSON.stringify(row)).not.toContain("dana@example.com");
  });

  it("carries the coordinates when the scan has them, and null when it does not", () => {
    expect(toScanHistoryRow(createScanWithRelations()).coordinates).toEqual({
      latitude: "51.97956847999077",
      longitude: "5.981302259884078",
    });
    expect(
      toScanHistoryRow(
        createScanWithRelations({ latitude: null, longitude: null })
      ).coordinates
    ).toBeNull();
  });

  it("describes the device, and never sends the raw user agent", () => {
    const companion = toScanHistoryRow(createScanWithRelations());
    expect(companion.device).toBe("Apple iPhone · Shelf app 1.3.0");
    expect(JSON.stringify(companion)).not.toContain("ShelfCompanion/");

    const unknown = toScanHistoryRow(
      createScanWithRelations({ userAgent: null })
    );
    expect(unknown.device).toBe("Unknown device");
  });

  it("sends the scan time as an ISO string, the shape it has on the wire", () => {
    const scan = createScanWithRelations();
    expect(toScanHistoryRow(scan).scannedAt).toBe(scan.createdAt.toISOString());
  });
});
