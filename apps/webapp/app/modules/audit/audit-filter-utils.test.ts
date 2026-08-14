import {
  AUDIT_ASSET_STATUS_LABELS,
  auditAssetStatusLabel,
} from "@shelf/labels";
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

    it("returns correct metadata for MISSING filter on a completed audit", () => {
      // why: the MISSING filter only means "missing" once the audit is closed.
      // The open-audit wording is covered in its own describe block below.
      const metadata = getAuditFilterMetadata("MISSING", true);

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

    it("defaults to ALL when null is provided", () => {
      const metadata = getAuditFilterMetadata(null);

      expect(metadata).toEqual({
        label: "All Assets",
        emptyState: {
          title: "No assets",
          text: "This audit has no assets.",
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
    describe("on active/pending audit (isAuditCompleted = false)", () => {
      it("returns Expected when audit data is null", () => {
        const status = getAuditStatusLabel(null);
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.PENDING);
      });

      it("returns Found for expected asset that was scanned", () => {
        const status = getAuditStatusLabel({
          expected: true,
          auditStatus: "FOUND",
        });
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.FOUND);
      });

      it("returns Missing for expected asset that wasn't scanned", () => {
        const status = getAuditStatusLabel({
          expected: true,
          auditStatus: "MISSING",
        });
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.MISSING);
      });

      it("returns Unexpected for non-expected asset that was scanned", () => {
        const status = getAuditStatusLabel({
          expected: false,
          auditStatus: "UNEXPECTED",
        });
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.UNEXPECTED);
      });

      it("returns Expected for expected asset with PENDING status", () => {
        const status = getAuditStatusLabel({
          expected: true,
          auditStatus: "PENDING",
        });
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.PENDING);
      });

      it("returns Expected for edge case of non-expected FOUND", () => {
        // Edge case: asset marked as found but not expected
        // This shouldn't happen in practice, but tests defensive behavior
        const status = getAuditStatusLabel({
          expected: false,
          auditStatus: "FOUND",
        });
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.PENDING);
      });

      it("returns Expected for edge case of non-expected MISSING", () => {
        // Edge case: asset marked as missing but not expected
        // This shouldn't happen in practice, but tests defensive behavior
        const status = getAuditStatusLabel({
          expected: false,
          auditStatus: "MISSING",
        });
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.PENDING);
      });
    });

    describe("on completed audit (isAuditCompleted = true)", () => {
      it("returns Missing when audit data is null", () => {
        const status = getAuditStatusLabel(null, true);
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.MISSING);
      });

      it("returns Found for expected asset that was scanned", () => {
        const status = getAuditStatusLabel(
          {
            expected: true,
            auditStatus: "FOUND",
          },
          true
        );
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.FOUND);
      });

      it("returns Missing for expected asset with PENDING status", () => {
        // Assets that weren't scanned during the audit are Missing in completed audits
        const status = getAuditStatusLabel(
          {
            expected: true,
            auditStatus: "PENDING",
          },
          true
        );
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.MISSING);
      });

      it("returns Missing for expected asset with MISSING status", () => {
        const status = getAuditStatusLabel(
          {
            expected: true,
            auditStatus: "MISSING",
          },
          true
        );
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.MISSING);
      });

      it("returns Unexpected for non-expected asset that was scanned", () => {
        const status = getAuditStatusLabel(
          {
            expected: false,
            auditStatus: "UNEXPECTED",
          },
          true
        );
        expect(status).toBe(AUDIT_ASSET_STATUS_LABELS.UNEXPECTED);
      });
    });
  });
});

describe("auditAssetStatusLabel (shared with the companion app)", () => {
  it("calls an unscanned asset 'Not scanned' while the audit is still open", () => {
    // why: `missingAssetCount` is seeded with the full expected count at
    // creation, so labelling it "Missing" told users a brand-new audit had
    // already lost every asset. Nothing is missing until the audit closes.
    expect(auditAssetStatusLabel("PENDING", false)).toBe("Not scanned");
  });

  it("calls an unscanned asset 'Missing' once the audit is completed", () => {
    expect(auditAssetStatusLabel("PENDING", true)).toBe("Missing");
  });

  it("leaves resolved statuses untouched in both states", () => {
    for (const completed of [false, true]) {
      expect(auditAssetStatusLabel("FOUND", completed)).toBe("Found");
      expect(auditAssetStatusLabel("MISSING", completed)).toBe("Missing");
      expect(auditAssetStatusLabel("UNEXPECTED", completed)).toBe("Unexpected");
    }
  });
});

describe("getAuditFilterMetadata — MISSING heading follows the audit state", () => {
  it("reads 'Not scanned Assets' while the audit is still open", () => {
    // why: this list is reached by clicking the statistics tile, which reads
    // "Not scanned" on an open audit. A "Missing Assets" heading would
    // contradict the control the user just clicked.
    const metadata = getAuditFilterMetadata("MISSING", false);
    expect(metadata.label).toBe("Not scanned Assets");
    expect(metadata.emptyState.title).toBe("Nothing left to scan");
  });

  it("reads 'Missing Assets' once the audit is completed", () => {
    const metadata = getAuditFilterMetadata("MISSING", true);
    expect(metadata.label).toBe("Missing Assets");
  });

  it("leaves the other filters alone in both states", () => {
    for (const completed of [false, true]) {
      expect(getAuditFilterMetadata("FOUND", completed).label).toBe(
        "Found Assets"
      );
      expect(getAuditFilterMetadata("EXPECTED", completed).label).toBe(
        "Expected Assets"
      );
      expect(getAuditFilterMetadata("ALL", completed).label).toBe("All Assets");
    }
  });
});
