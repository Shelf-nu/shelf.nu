/**
 * Tests for scan UA attribution.
 *
 * The companion app sends `ShelfCompanion/<version> (<device>; <os>)` on
 * every API call; parseCompanionUserAgent must recognize exactly that and
 * synthesize the parsed shape the scan panel renders, while every other
 * UA falls through to ua-parser-js untouched.
 *
 * @see apps/companion/lib/api/user-agent.ts
 */
import { describe, expect, it } from "vitest";

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
  // why: parseScanData only reads plain fields off the scan record; a
  // literal fixture keeps the test honest without a database.
  const baseScan = {
    id: "scan-1",
    latitude: "51.97",
    longitude: "5.98",
    userAgent: "ShelfCompanion/1.3.0 (iPhone; iOS 18.6)",
    userId: "user-1",
    qrId: "qr-1",
    rawQrId: "qr-1",
    manuallyGenerated: false,
    createdAt: new Date("2026-08-12T13:10:00Z"),
    updatedAt: new Date("2026-08-12T13:10:00Z"),
    user: null,
    qr: null,
  } as unknown as Parameters<typeof parseScanData>[0]["scan"];

  it("routes the companion UA through the app attribution", () => {
    const result = parseScanData({ scan: baseScan, userId: "user-1" });

    expect(result?.ua.browser.name).toBe("Shelf app 1.3.0");
    expect(result?.ua.device.vendor).toBe("Apple");
  });

  it("still parses browser user agents with ua-parser-js", () => {
    const scan = {
      ...(baseScan as object),
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    } as typeof baseScan;

    const result = parseScanData({ scan, userId: "user-1" });

    expect(result?.ua.browser.name).toBe("Safari");
    expect(result?.ua.os.name).toBe("Mac OS");
  });
});
