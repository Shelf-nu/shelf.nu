import { describe, it, expect, vi } from "vitest";

import {
  formatSequentialId,
  isValidSequentialIdFormat,
  extractSequenceNumber,
} from "./sequential-id.server";

// Mock the database connection to avoid connection errors in unit tests
vi.mock("~/database/db.server", () => ({
  db: {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    asset: {
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

// @vitest-environment node

describe("Sequential ID Service - Pure Functions", () => {
  describe("formatSequentialId", () => {
    it("should format sequential ID with default prefix and padding", () => {
      expect(formatSequentialId(1)).toBe("SAM-0001");
      expect(formatSequentialId(42)).toBe("SAM-0042");
      expect(formatSequentialId(999)).toBe("SAM-0999");
      expect(formatSequentialId(1000)).toBe("SAM-1000");
      expect(formatSequentialId(12345)).toBe("SAM-12345");
      expect(formatSequentialId(180005)).toBe("SAM-180005");
    });

    it("should format sequential ID with custom prefix", () => {
      expect(formatSequentialId(1, "ASSET")).toBe("ASSET-0001");
      expect(formatSequentialId(42, "TEST")).toBe("TEST-0042");
      expect(formatSequentialId(1000, "EQUIP")).toBe("EQUIP-1000");
    });

    it("should handle edge cases", () => {
      expect(formatSequentialId(0)).toBe("SAM-0000");
      expect(formatSequentialId(999999)).toBe("SAM-999999");
    });
  });

  describe("isValidSequentialIdFormat", () => {
    it("should validate correct sequential ID formats", () => {
      expect(isValidSequentialIdFormat("SAM-0001")).toBe(true);
      expect(isValidSequentialIdFormat("SAM-1000")).toBe(true);
      expect(isValidSequentialIdFormat("SAM-180005")).toBe(true);
      expect(isValidSequentialIdFormat("ASSET-0042")).toBe(true);
      expect(isValidSequentialIdFormat("TEST-999999")).toBe(true);
    });

    it("should reject invalid sequential ID formats", () => {
      // Missing prefix
      expect(isValidSequentialIdFormat("0001")).toBe(false);
      expect(isValidSequentialIdFormat("-0001")).toBe(false);

      // Missing number
      expect(isValidSequentialIdFormat("SAM-")).toBe(false);
      expect(isValidSequentialIdFormat("SAM")).toBe(false);

      // Invalid characters
      expect(isValidSequentialIdFormat("SAM-001A")).toBe(false);
      expect(isValidSequentialIdFormat("SAM-00.1")).toBe(false);
      expect(isValidSequentialIdFormat("SAM_0001")).toBe(false);

      // Empty or null
      expect(isValidSequentialIdFormat("")).toBe(false);
      expect(isValidSequentialIdFormat(" ")).toBe(false);

      // Leading zeros in number part are allowed
      expect(isValidSequentialIdFormat("SAM-0001")).toBe(true);
      expect(isValidSequentialIdFormat("SAM-00001")).toBe(true);

      // Multiple hyphens
      expect(isValidSequentialIdFormat("SAM-TEST-001")).toBe(false);

      // Lowercase prefix (should be rejected if we enforce uppercase)
      expect(isValidSequentialIdFormat("sam-0001")).toBe(false);
    });
  });

  describe("extractSequenceNumber", () => {
    it("should extract sequence number from valid sequential IDs", () => {
      expect(extractSequenceNumber("SAM-0001")).toBe(1);
      expect(extractSequenceNumber("SAM-0042")).toBe(42);
      expect(extractSequenceNumber("SAM-0999")).toBe(999);
      expect(extractSequenceNumber("SAM-1000")).toBe(1000);
      expect(extractSequenceNumber("SAM-12345")).toBe(12345);
      expect(extractSequenceNumber("SAM-180005")).toBe(180005);
      expect(extractSequenceNumber("ASSET-0001")).toBe(1);
      expect(extractSequenceNumber("TEST-999999")).toBe(999999);
    });

    it("should handle leading zeros correctly", () => {
      expect(extractSequenceNumber("SAM-0001")).toBe(1);
      expect(extractSequenceNumber("SAM-00001")).toBe(1);
      expect(extractSequenceNumber("SAM-000042")).toBe(42);
    });

    it("should return null for invalid sequential IDs", () => {
      expect(extractSequenceNumber("")).toBe(null);
      expect(extractSequenceNumber("SAM-")).toBe(null);
      expect(extractSequenceNumber("SAM")).toBe(null);
      expect(extractSequenceNumber("0001")).toBe(null);
      expect(extractSequenceNumber("SAM-001A")).toBe(null);
      expect(extractSequenceNumber("SAM-00.1")).toBe(null);
      expect(extractSequenceNumber("SAM_0001")).toBe(null);
      expect(extractSequenceNumber("sam-0001")).toBe(null);
    });

    it("should handle edge case of zero", () => {
      expect(extractSequenceNumber("SAM-0000")).toBe(0);
      expect(extractSequenceNumber("SAM-00000")).toBe(0);
    });
  });

  describe("Integration tests for pure functions", () => {
    it("should work together: format -> validate -> extract", () => {
      const testNumbers = [1, 42, 999, 1000, 12345, 180005];

      for (const num of testNumbers) {
        // Format the number
        const formatted = formatSequentialId(num);

        // Validate the format
        expect(isValidSequentialIdFormat(formatted)).toBe(true);

        // Extract should return original number
        expect(extractSequenceNumber(formatted)).toBe(num);
      }
    });

    it("should work with different prefixes", () => {
      const prefixes = ["SAM", "ASSET", "EQUIP", "TEST"];
      const number = 1234;

      for (const prefix of prefixes) {
        const formatted = formatSequentialId(number, prefix);
        expect(isValidSequentialIdFormat(formatted)).toBe(true);
        expect(extractSequenceNumber(formatted)).toBe(number);
        expect(formatted).toBe(`${prefix}-1234`);
      }
    });
  });
});

// Note: Database-dependent functions like getNextSequentialId, createOrganizationSequence,
// generateBulkSequentialIdsEfficient, etc. require integration tests with a real database
// and are covered by the E2E tests and integration test suite.
