/**
 * @file Reports row-click handler hook.
 *
 * Every report's table needs an `onRowClick` that navigates to the
 * underlying entity (booking or asset). Rather than 8 near-identical
 * `useCallback` declarations in the route, we centralise into two
 * stable handlers — `onBookingRowClick` / `onAssetRowClick` — and
 * rely on TypeScript's structural function-type compatibility to feed
 * them into each report's per-row prop type.
 *
 * Stability is important: every report content component receives this
 * function as `onRowClick`, and any new identity per render would
 * propagate down through TanStack `flexRender`, remount AssetCell →
 * AssetImage and trigger an image-fetch storm. See the prior fix on
 * the reports loop bug for the original failure mode.
 *
 * @see {@link file://./../../routes/_layout+/reports.$reportId.tsx}
 */

import { useCallback } from "react";
import { useNavigate } from "react-router";

/** Stable click handlers shared by every report's data table. */
export type ReportRowHandlers = {
  /** Navigate to a booking detail page. Accepts any row that exposes
   *  a `bookingId`. */
  onBookingRowClick: (row: { bookingId: string }) => void;
  /** Navigate to an asset detail page. Accepts any row that exposes
   *  an `assetId`. */
  onAssetRowClick: (row: { assetId: string }) => void;
};

/**
 * Returns memoised row-click handlers for use across all report
 * content components. Identity-stable across re-renders.
 */
export function useReportRowHandlers(): ReportRowHandlers {
  const navigate = useNavigate();

  const onBookingRowClick = useCallback(
    (row: { bookingId: string }) => {
      void navigate(`/bookings/${row.bookingId}`);
    },
    [navigate]
  );

  const onAssetRowClick = useCallback(
    (row: { assetId: string }) => {
      void navigate(`/assets/${row.assetId}`);
    },
    [navigate]
  );

  return { onBookingRowClick, onAssetRowClick };
}
