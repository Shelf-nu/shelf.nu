/**
 * Status Label Helpers
 *
 * Pure mappings from {@link ExtendedAssetStatus} to user-facing label
 * strings and badge color schemes. Reused by the asset status badge UI
 * and by callers that render the same status in other contexts (the
 * dashboard, filter summaries, the advanced-filters value picker).
 *
 * No React, no I/O — safe to import from server-only modules.
 */

import { AssetStatus } from "@prisma/client";
import { BADGE_COLORS, type BadgeColorScheme } from "~/utils/badge-colors";
import type { ExtendedAssetStatus } from "~/utils/booking-assets";

/**
 * Maps a status (including the booking-context-only `PARTIALLY_CHECKED_IN`
 * pseudo-statuses) to its user-facing label.
 *
 * @param status The asset status, or a booking-context pseudo-status
 * @returns Short human-readable label suitable for a badge
 */
export const userFriendlyAssetStatus = (status: ExtendedAssetStatus) => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return "In custody";
    case AssetStatus.CHECKED_OUT:
      return "Checked out";
    case "PARTIALLY_CHECKED_IN":
      return "Already checked in";
    case "PARTIALLY_CHECKED_IN_QTY":
      // Legacy Phase 3c label — kept for any caller that still needs the
      // "partially in" wording. Booking rows use PARTIALLY_CHECKED_OUT_QTY
      // instead to emphasise "work still outstanding".
      return "Partially checked in";
    case "PARTIALLY_CHECKED_OUT_QTY":
      // Qty-tracked: some units of THIS row dispositioned, some still
      // outstanding. Wording matches the global qty-aware breakdown so
      // a row that's partly returned reads consistently with how it
      // looks on the asset index / asset overview.
      return "Partially checked out";
    default:
      return "Available";
  }
};

/**
 * Maps a status to its badge color scheme. Pairs with
 * {@link userFriendlyAssetStatus}.
 */
export const assetStatusColorMap = (
  status: ExtendedAssetStatus
): BadgeColorScheme => {
  switch (status) {
    case AssetStatus.IN_CUSTODY:
      return BADGE_COLORS.blue;
    case "PARTIALLY_CHECKED_IN":
      return BADGE_COLORS.blue;
    case "PARTIALLY_CHECKED_IN_QTY":
      // Amber to signal "action still required" — there's work left on
      // this row, unlike the solid blue "done for this row" state.
      return BADGE_COLORS.amber;
    case "PARTIALLY_CHECKED_OUT_QTY":
      // Violet matches the global qty-aware "Partially checked out"
      // colour so a partly-returned row reads as still-out, not as a
      // distinct "this row is partway in" state.
      return BADGE_COLORS.violet;
    case AssetStatus.CHECKED_OUT:
      return BADGE_COLORS.violet;
    default:
      // AVAILABLE
      return BADGE_COLORS.green;
  }
};
