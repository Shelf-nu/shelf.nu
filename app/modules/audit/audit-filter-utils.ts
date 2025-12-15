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
  // If no filter is provided, default to "EXPECTED" (show expected assets)
  const normalizedFilter = (filterType || "EXPECTED") as AuditFilterType;
  return FILTER_METADATA[normalizedFilter] || FILTER_METADATA.ALL;
}

import type { AuditAssetStatus } from "@prisma/client";

export type AuditStatusLabel =
  | "Expected"
  | "Found"
  | "Missing"
  | "Unexpected";

/**
 * Determine the audit status label for an asset based on its audit data.
 * Used to display status badges in the "ALL" filter view.
 */
export function getAuditStatusLabel(
  auditData: { expected: boolean; auditStatus: AuditAssetStatus } | null
): AuditStatusLabel {
  if (!auditData) return "Expected";

  // Found: Expected asset that was scanned
  if (auditData.expected && auditData.auditStatus === "FOUND") {
    return "Found";
  }

  // Missing: Expected asset that wasn't scanned
  if (auditData.expected && auditData.auditStatus === "MISSING") {
    return "Missing";
  }

  // Unexpected: Asset that was scanned but not expected
  if (!auditData.expected && auditData.auditStatus === "UNEXPECTED") {
    return "Unexpected";
  }

  // Default: Expected (covers PENDING status)
  return "Expected";
}
