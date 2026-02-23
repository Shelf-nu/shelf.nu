import type { AuditAssetStatus } from "@prisma/client";

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
    label: "Missing Assets",
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
  filterType: string | null
): AuditFilterMetadata {
  // If no filter is provided, default to "ALL" (show all assets)
  const normalizedFilter = (filterType || "ALL") as AuditFilterType;
  return FILTER_METADATA[normalizedFilter] || FILTER_METADATA.ALL;
}

export type AuditStatusLabel = "Expected" | "Found" | "Missing" | "Unexpected";

/**
 * Determine the audit status label for an asset based on its audit data.
 * Used to display status badges in the "ALL" filter view.
 *
 * The label changes based on audit completion state:
 * - Active/Pending audit: Expected assets show "Expected" or "Found"
 * - Completed audit: Expected assets that weren't scanned show "Missing" instead of "Expected"
 *
 * @param auditData - The asset's audit status data
 * @param isAuditCompleted - Whether the audit has been completed (default: false)
 */
export function getAuditStatusLabel(
  auditData: { expected: boolean; auditStatus: AuditAssetStatus } | null,
  isAuditCompleted: boolean = false
): AuditStatusLabel {
  if (!auditData) return isAuditCompleted ? "Missing" : "Expected";

  // Found: Expected asset that was scanned
  if (auditData.expected && auditData.auditStatus === "FOUND") {
    return "Found";
  }

  // Missing: Expected asset that wasn't scanned (always shows as Missing)
  if (auditData.expected && auditData.auditStatus === "MISSING") {
    return "Missing";
  }

  // Unexpected: Asset that was scanned but not expected
  if (!auditData.expected && auditData.auditStatus === "UNEXPECTED") {
    return "Unexpected";
  }

  // Expected assets with PENDING status:
  // - On completed audit: Show as "Missing" (they weren't scanned)
  // - On active/pending audit: Show as "Expected" (still waiting to be scanned)
  if (auditData.expected && auditData.auditStatus === "PENDING") {
    return isAuditCompleted ? "Missing" : "Expected";
  }

  // Default fallback
  return isAuditCompleted ? "Missing" : "Expected";
}
