/**
 * Unit tests for the mobile app's extractQrId function.
 *
 * This function is the discriminator that determines whether a scanned
 * code is a Shelf QR code or a barcode. When it returns null, the
 * scanner falls back to barcode lookup.
 */
import { extractQrId } from "../../../mobile/lib/qr-utils";

// @vitest-environment node

describe("extractQrId", () => {
  // ── Should MATCH (Shelf QR codes) ──────────────────

  describe("full URL format: https://<domain>/qr/<id>", () => {
    it("should extract ID from standard Shelf URL", () => {
      expect(extractQrId("https://app.shelf.nu/qr/abc123def456")).toBe(
        "abc123def456"
      );
    });

    it("should extract mixed-case ID from full URL", () => {
      expect(extractQrId("https://shelf.nu/qr/XyZ789")).toBe("XyZ789");
    });

    it("should handle HTTP scheme", () => {
      expect(extractQrId("http://localhost:3000/qr/test123")).toBe("test123");
    });

    it("should handle subdomains", () => {
      expect(extractQrId("https://staging.shelf.nu/qr/abcdef1234")).toBe(
        "abcdef1234"
      );
    });
  });

  describe("URL shortener format: https://<domain>/<id>", () => {
    it("should extract 10-char shortener ID", () => {
      expect(extractQrId("https://s.shelf.nu/abcdefghij")).toBe("abcdefghij");
    });

    it("should extract 25-char shortener ID", () => {
      expect(extractQrId("https://s.shelf.nu/abcdefghijklmnopqrstuvwxy")).toBe(
        "abcdefghijklmnopqrstuvwxy"
      );
    });
  });

  describe("raw ID format: 10-25 char lowercase alphanumeric", () => {
    it("should match 10-char raw ID", () => {
      expect(extractQrId("abcdefghij")).toBe("abcdefghij");
    });

    it("should match 25-char raw ID", () => {
      expect(extractQrId("abcdefghijklmnopqrstuvwxy")).toBe(
        "abcdefghijklmnopqrstuvwxy"
      );
    });

    it("should match raw ID with digits", () => {
      expect(extractQrId("abc1234567")).toBe("abc1234567");
    });
  });

  // ── Should NOT MATCH (barcodes and other codes) ────

  describe("barcode values that should return null", () => {
    it("should reject uppercase barcode value", () => {
      expect(extractQrId("BC001234")).toBeNull();
    });

    it("should reject EAN-13 barcode (all digits)", () => {
      expect(extractQrId("1234567890128")).toBeNull();
    });

    it("should reject Code128 with hyphens", () => {
      expect(extractQrId("ASSET-2024-001")).toBeNull();
    });

    it("should reject barcode starting with digit", () => {
      expect(extractQrId("1abcdefghi")).toBeNull();
    });
  });

  describe("edge cases that should return null", () => {
    it("should reject empty string", () => {
      expect(extractQrId("")).toBeNull();
    });

    it("should reject too-short string (5 chars)", () => {
      expect(extractQrId("short")).toBeNull();
    });

    it("should reject too-short string (9 chars)", () => {
      expect(extractQrId("abcdefghi")).toBeNull();
    });

    it("should reject too-long string (26 chars)", () => {
      expect(extractQrId("abcdefghijklmnopqrstuvwxyz")).toBeNull();
    });

    it("should reject random URL", () => {
      expect(extractQrId("https://google.com")).toBeNull();
    });

    it("should reject URL with additional path segments after QR ID", () => {
      expect(extractQrId("https://shelf.nu/qr/abc123/extra")).toBeNull();
    });

    it("should reject raw ID with uppercase characters", () => {
      expect(extractQrId("ABCDEFGHIJ")).toBeNull();
    });
  });
});
