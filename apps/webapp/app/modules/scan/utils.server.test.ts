/**
 * Tests for scan UA attribution and the "Last scan" card payload.
 *
 * The companion app sends `ShelfCompanion/<version> (<device>; <os>)` on
 * every API call; parseCompanionUserAgent must recognize exactly that and
 * synthesize the parsed shape the scan panel renders, while every other
 * UA falls through to ua-parser-js untouched.
 *
 * @see apps/companion/lib/api/user-agent.ts
 */
import type { UserOrganization } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { createScanWithRelations, createUser } from "@factories";

import { parseCompanionUserAgent, parseScanData } from "./utils.server";

describe("parseCompanionUserAgent", () => {
  it("attributes an iPhone scan to the app", () => {
    const result = parseCompanionUserAgent(
      "ShelfCompanion/1.3.0 (iPhone; iOS 18.6)"
    );

    expect(result).not.toBeNull();
    expect(result?.device).toEqual({
      vendor: "Apple",
      model: "iPhone",
      type: "mobile",
    });
    expect(result?.browser.name).toBe("Shelf app 1.3.0");
    expect(result?.os).toEqual({ name: "iOS", version: "18.6" });
  });

  it("attributes an iPad scan to the app", () => {
    const result = parseCompanionUserAgent(
      "ShelfCompanion/1.4.1 (iPad; iOS 19)"
    );

    expect(result?.device.model).toBe("iPad");
    // why: ua-parser-js uses "tablet" for tablets, and downstream consumers
    // read device.type. Reporting an iPad as "mobile" mislabels every scan
    // from one.
    expect(result?.device.type).toBe("tablet");
    expect(result?.browser.version).toBe("1.4.1");
  });

  it("splits Android brand and model into vendor and model", () => {
    const result = parseCompanionUserAgent(
      "ShelfCompanion/1.3.0 (google Pixel 8; Android 14)"
    );

    expect(result?.device).toEqual({
      vendor: "Google",
      model: "Pixel 8",
      type: "mobile",
    });
    expect(result?.os).toEqual({ name: "Android", version: "14" });
  });

  it("copes with a bare Android device token", () => {
    const result = parseCompanionUserAgent(
      "ShelfCompanion/1.3.0 (Android; Android 14)"
    );

    // The panel requires BOTH vendor and model to render a device line.
    expect(result?.device.vendor).toBe("Android");
    expect(result?.device.model).toBe("device");
  });

  it("returns null for browser user agents", () => {
    expect(
      parseCompanionUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
      )
    ).toBeNull();
  });

  it("returns null for the server-side null-header fallback and empty input", () => {
    // qr.$qrId.ts stores the literal "mobile-companion" when no UA arrives.
    expect(parseCompanionUserAgent("mobile-companion")).toBeNull();
    expect(parseCompanionUserAgent("")).toBeNull();
    expect(parseCompanionUserAgent(null)).toBeNull();
    expect(parseCompanionUserAgent(undefined)).toBeNull();
  });

  it("rejects look-alikes that embed the prefix mid-string", () => {
    expect(
      parseCompanionUserAgent(
        "Mozilla/5.0 ShelfCompanion/1.3.0 (iPhone; iOS 18.6)"
      )
    ).toBeNull();
  });
});

describe("parseScanData", () => {
  it("routes the companion UA through the app attribution", () => {
    const result = parseScanData({
      scan: createScanWithRelations(),
      userId: "user-1",
    });

    expect(result?.ua.browser.name).toBe("Shelf app 1.3.0");
    expect(result?.ua.device.vendor).toBe("Apple");
  });

  it("still parses browser user agents with ua-parser-js", () => {
    const result = parseScanData({
      scan: createScanWithRelations({
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
      }),
      userId: "user-1",
    });

    expect(result?.ua.browser.name).toBe("Safari");
    expect(result?.ua.os.name).toBe("Mac OS");
  });

  it("leaves the rest of the payload intact for an app scan", () => {
    const result = parseScanData({
      scan: createScanWithRelations(),
      userId: "user-1",
    });

    // why: the UA change must not disturb the other fields the panel reads.
    expect(result?.coordinates).toBe("51.97956847999077, 5.981302259884078");
    expect(result?.manuallyGenerated).toBe(false);
  });

  /** A scanning user who is a member of exactly one workspace. */
  function scannerIn(organizationId: string) {
    const membership: UserOrganization = {
      id: "uo-1",
      userId: "user-9",
      organizationId,
      roles: ["ADMIN"],
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
      calendarTokenId: null,
    };
    return {
      ...createUser({
        id: "user-9",
        firstName: "Dana",
        lastName: "Reeves",
        displayName: "Dana Reeves",
        email: "dana@example.com",
      }),
      userOrganizations: [membership],
    };
  }

  it("names a member of the workspace the scan resolved in, with no QR on the row", () => {
    // A barcode scan carries no QR: the scan's own workspace decides.
    const result = parseScanData({
      scan: createScanWithRelations({
        codeType: "BARCODE",
        code: "BC-0042",
        qrId: null,
        rawQrId: null,
        organizationId: "org-1",
        user: scannerIn("org-1"),
      }),
      userId: "user-1",
    });

    expect(result?.scannedBy).toBe("Dana Reeves(dana@example.com)");
  });

  it("does not name a scanner from another workspace", () => {
    const result = parseScanData({
      scan: createScanWithRelations({
        organizationId: "org-1",
        user: scannerIn("org-2"),
      }),
      userId: "user-1",
    });

    expect(result?.scannedBy).toBe("Unknown");
  });

  it("falls back to the QR's workspace on a row that has none", () => {
    const result = parseScanData({
      scan: createScanWithRelations({
        organizationId: null,
        qr: {
          id: "qr-1",
          version: 0,
          errorCorrection: "L",
          assetId: "asset-1",
          kitId: null,
          userId: "user-1",
          organizationId: "org-1",
          batchId: null,
          createdAt: new Date("2026-01-01"),
          updatedAt: new Date("2026-01-01"),
        },
        user: scannerIn("org-1"),
      }),
      userId: "user-1",
    });

    expect(result?.scannedBy).toBe("Dana Reeves(dana@example.com)");
  });

  it("exposes the scanned value for a barcode or SAM ID, never for a QR", () => {
    const barcode = parseScanData({
      scan: createScanWithRelations({ codeType: "BARCODE", code: "BC-0042" }),
      userId: "user-1",
    });
    const sam = parseScanData({
      scan: createScanWithRelations({ codeType: "SAM_ID", code: "SAM-0007" }),
      userId: "user-1",
    });
    const qr = parseScanData({
      scan: createScanWithRelations({ codeType: "QR", code: "qr-1" }),
      userId: "user-1",
    });

    expect(barcode).toMatchObject({ codeType: "BARCODE", code: "BC-0042" });
    expect(sam).toMatchObject({ codeType: "SAM_ID", code: "SAM-0007" });
    expect(qr).toMatchObject({ codeType: "QR", code: null });
  });
});
