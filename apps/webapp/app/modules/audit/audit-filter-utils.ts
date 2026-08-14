import type { AuditAssetStatus } from "@prisma/client";
import {
  AUDIT_ASSET_STATUS_LABELS,
  auditAssetStatusLabel,
  type AuditAssetStatusLabel,
} from "@shelf/labels";

export type AuditFilterType =
  | "ALL"
  | "EXPECTED"
  | "FOUND"
  | "MISSING"
  | "UNEXPECTED";

interface EmptyStateContent {
  title: string;
  text: string;
}

interface AuditFilterMetadata {
  label: string;
  emptyState: EmptyStateContent;
}

const FILTER_METADATA: Record<AuditFilterType, AuditFilterMetadata> = {
  ALL: {
    label: "All Assets",
    emptyState: {
      title: "No assets",
      text: "This audit has no assets.",
    },
  },
  EXPECTED: {
    label: "Expected Assets",
    emptyState: {
      title: "No expected assets",
      text: "This audit has no assets assigned to it.",
    },
  },
  FOUND: {
    label: "Found Assets",
    emptyState: {
      title: "No found assets",
      text: "No assets have been scanned yet. Start scanning to see found assets here.",
    },
  },
  MISSING: {
    label: `${AUDIT_ASSET_STATUS_LABELS.MISSING} Assets`,
    emptyState: {
      title: "No missing assets",
      text: "All expected assets have been found. Great job!",
    },
  },
  UNEXPECTED: {
    label: "Unexpected Assets",
    emptyState: {
      title: "No unexpected assets",
      text: "No unexpected assets were scanned during this audit.",
    },
  },
};

/**
 * Get filter metadata (label and empty state) for a given audit filter type.
 * Falls back to ALL metadata if invalid filter type is provided.
 */
export function getAuditFilterMetadata(
  filterType: string | null,
  isAuditCompleted: boolean = false
): AuditFilterMetadata {
  // If no filter is provided, default to "ALL" (show all assets)
  const normalizedFilter = (filterType || "ALL") as AuditFilterType;
  const metadata = FILTER_METADATA[normalizedFilter] || FILTER_METADATA.ALL;

  // why: the MISSING filter is reached by clicking the statistics tile, and
  // that tile reads "Not scanned" until the audit is completed. Leaving this
  // heading as "Missing Assets" would contradict the control the user just
  // clicked, and would re-assert the very claim this rule removes: nothing is
  // missing until the audit closes. The URL key stays MISSING so existing
  // links keep working.
  if (normalizedFilter === "MISSING" && !isAuditCompleted) {
    return {
      label: `${AUDIT_ASSET_STATUS_LABELS.PENDING} Assets`,
      emptyState: {
        title: "Nothing left to scan",
        text: "Every expected asset has been found. Great job!",
      },
    };
  }

  return metadata;
}

/**
 * Canonical per-asset audit status label, owned by `@shelf/labels` so the
 * companion app renders the exact same words.
 */
export type AuditStatusLabel = AuditAssetStatusLabel;

/**
 * Determine the audit status label for an asset based on its audit data.
 * Used to display status badges in the "ALL" filter view.
 *
 * The label changes based on audit completion state:
 * - Active/Pending audit: expected assets show "Not scanned" or "Found"
 * - Completed audit: expected assets that weren't scanned show "Missing"
 *
 * @param auditData - The asset's audit status data
 * @param isAuditCompleted - Whether the audit has been completed (default: false)
 */
export function getAuditStatusLabel(
  auditData: { expected: boolean; auditStatus: AuditAssetStatus } | null,
  isAuditCompleted: boolean = false
): AuditStatusLabel {
  if (!auditData) return auditAssetStatusLabel("PENDING", isAuditCompleted);

  // Found: Expected asset that was scanned
  if (auditData.expected && auditData.auditStatus === "FOUND") {
    return AUDIT_ASSET_STATUS_LABELS.FOUND;
  }

  // Missing: Expected asset that wasn't scanned (always shows as Missing)
  if (auditData.expected && auditData.auditStatus === "MISSING") {
    return AUDIT_ASSET_STATUS_LABELS.MISSING;
  }

  // Unexpected: Asset that was scanned but not expected
  if (!auditData.expected && auditData.auditStatus === "UNEXPECTED") {
    return AUDIT_ASSET_STATUS_LABELS.UNEXPECTED;
  }

  // Expected assets with PENDING status:
  // - On completed audit: Show as "Missing" (they weren't scanned)
  // - On active/pending audit: Show as "Expected" (still waiting to be scanned)
  if (auditData.expected && auditData.auditStatus === "PENDING") {
    return auditAssetStatusLabel("PENDING", isAuditCompleted);
  }

  // Default fallback
  return auditAssetStatusLabel("PENDING", isAuditCompleted);
}
