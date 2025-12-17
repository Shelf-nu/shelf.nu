import { describe, expect, it } from "vitest";

import {
  getAuditFilterMetadata,
  getAuditStatusLabel,
  type AuditFilterType,
} from "./audit-filter-utils";

describe("audit filter utils", () => {
  describe("getAuditFilterMetadata", () => {
    it("returns correct metadata for ALL filter", () => {
      const metadata = getAuditFilterMetadata("ALL");

      expect(metadata).toEqual({
        label: "All Assets",
        emptyState: {
          title: "No assets",
          text: "This audit has no assets.",
        },
      });
    });

    it("returns correct metadata for EXPECTED filter", () => {
      const metadata = getAuditFilterMetadata("EXPECTED");

      expect(metadata).toEqual({
        label: "Expected Assets",
        emptyState: {
          title: "No expected assets",
          text: "This audit has no assets assigned to it.",
        },
      });
    });

    it("returns correct metadata for FOUND filter", () => {
      const metadata = getAuditFilterMetadata("FOUND");

      expect(metadata).toEqual({
        label: "Found Assets",
        emptyState: {
          title: "No found assets",
          text: "No assets have been scanned yet. Start scanning to see found assets here.",
        },
      });
    });

    it("returns correct metadata for MISSING filter", () => {
      const metadata = getAuditFilterMetadata("MISSING");

      expect(metadata).toEqual({
        label: "Missing Assets",
        emptyState: {
          title: "No missing assets",
          text: "All expected assets have been found. Great job!",
        },
      });
    });

    it("returns correct metadata for UNEXPECTED filter", () => {
      const metadata = getAuditFilterMetadata("UNEXPECTED");

      expect(metadata).toEqual({
        label: "Unexpected Assets",
        emptyState: {
          title: "No unexpected assets",
          text: "No unexpected assets were scanned during this audit.",
        },
      });
    });

    it("defaults to EXPECTED when null is provided", () => {
      const metadata = getAuditFilterMetadata(null);

      expect(metadata).toEqual({
        label: "Expected Assets",
        emptyState: {
          title: "No expected assets",
          text: "This audit has no assets assigned to it.",
        },
      });
    });

    it("falls back to ALL metadata for invalid filter type", () => {
      const metadata = getAuditFilterMetadata(
        "INVALID_TYPE" as AuditFilterType
      );

      expect(metadata).toEqual({
        label: "All Assets",
        emptyState: {
          title: "No assets",
          text: "This audit has no assets.",
        },
      });
    });
  });

  describe("getAuditStatusLabel", () => {
    it("returns Expected when audit data is null", () => {
      const status = getAuditStatusLabel(null);
      expect(status).toBe("Expected");
    });

    it("returns Found for expected asset that was scanned", () => {
      const status = getAuditStatusLabel({
        expected: true,
        auditStatus: "FOUND",
      });
      expect(status).toBe("Found");
    });

    it("returns Missing for expected asset that wasn't scanned", () => {
      const status = getAuditStatusLabel({
        expected: true,
        auditStatus: "MISSING",
      });
      expect(status).toBe("Missing");
    });

    it("returns Unexpected for non-expected asset that was scanned", () => {
      const status = getAuditStatusLabel({
        expected: false,
        auditStatus: "UNEXPECTED",
      });
      expect(status).toBe("Unexpected");
    });

    it("returns Expected for expected asset with PENDING status", () => {
      const status = getAuditStatusLabel({
        expected: true,
        auditStatus: "PENDING",
      });
      expect(status).toBe("Expected");
    });

    it("returns Expected for edge case of non-expected FOUND", () => {
      // Edge case: asset marked as found but not expected
      // This shouldn't happen in practice, but tests defensive behavior
      const status = getAuditStatusLabel({
        expected: false,
        auditStatus: "FOUND",
      });
      expect(status).toBe("Expected");
    });

    it("returns Expected for edge case of non-expected MISSING", () => {
      // Edge case: asset marked as missing but not expected
      // This shouldn't happen in practice, but tests defensive behavior
      const status = getAuditStatusLabel({
        expected: false,
        auditStatus: "MISSING",
      });
      expect(status).toBe("Expected");
    });
  });
});
