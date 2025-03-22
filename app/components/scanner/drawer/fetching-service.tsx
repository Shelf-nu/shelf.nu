import { useCallback, useEffect } from "react";
import { useSetAtom } from "jotai";
import type { ScanListItem } from "~/atoms/qr-scanner";
import { updateScannedItemAtom } from "~/atoms/qr-scanner";

/**
 * Hook that provides item fetching functionality for scanner components
 * This centralizes the fetch logic to avoid duplicating it in each drawer implementation
 */

/**
 * Hook that provides item fetching functionality for scanner components
 * This centralizes the fetch logic to avoid duplicating it in each drawer implementation
 */
export function useItemFetcher() {
  const setItem = useSetAtom(updateScannedItemAtom);

  /**
   * Fetch item data based on QR code ID
   * This is the central function that handles fetching for all scanner drawers
   */
  const fetchItem = useCallback(
    async (qrId: string) => {
      try {
        const request = await fetch(`/api/get-scanned-item/${qrId}`);
        const response = await request.json();

        /** If the server returns an error, add it to the item and return */
        if (response.error) {
          setItem({
            qrId,
            item: { error: response.error.message },
          });
          return;
        }

        const qr = response.qr;

        /** Determine item type (asset or kit) and update accordingly */
        if (qr && qr.type === "asset") {
          const itemWithType: ScanListItem = {
            data: qr.asset,
            type: "asset",
          };

          if (itemWithType.data) {
            setItem({
              qrId,
              item: itemWithType,
            });
          }
        } else if (qr && qr.type === "kit") {
          const itemWithType: ScanListItem = {
            data: qr.kit,
            type: "kit",
          };

          if (itemWithType.data) {
            setItem({
              qrId,
              item: itemWithType,
            });
          }
        }
      } catch (error) {
        setItem({
          qrId,
          item: { error: "Failed to fetch item" },
        });
      }
    },
    [setItem]
  );

  return { fetchItem };
}

/**
 * Component that automatically fetches items that don't have data yet
 */
export function ItemFetcher({
  items,
  fetchItem,
}: {
  items: Record<string, any>;
  fetchItem: (qrId: string) => Promise<void>;
}) {
  useEffect(() => {
    // For each item in the items object, fetch the item if it doesn't have data
    Object.entries(items).forEach(([qrId, item]) => {
      // If item doesn't exist or doesn't have data or error yet, fetch it
      if (!item || (item && !item.data && !item.error)) {
        void fetchItem(qrId);
      }
    });
  }, [items, fetchItem]);

  return null; // This component doesn't render anything
}
