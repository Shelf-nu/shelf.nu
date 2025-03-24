import { useCallback, useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { useSetAtom } from "jotai";
import type { ScanListItem } from "~/atoms/qr-scanner";
import { updateScannedItemAtom } from "~/atoms/qr-scanner";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import { tw } from "~/utils/tw";

// Type for the row props
type GenericItemRowProps<T> = {
  qrId: string;
  item: ScanListItem | undefined;
  onRemove: (qrId: string) => void;
  renderItem: (item: T) => React.ReactNode;
  renderLoading: (qrId: string, error?: string) => React.ReactNode;
};

/**
 * Generic component for rendering a row in the scanned items table
 * With self-contained fetch functionality
 */
export function GenericItemRow<T>({
  qrId,
  item,
  onRemove,
  renderItem,
  renderLoading,
}: GenericItemRowProps<T>) {
  const setItem = useSetAtom(updateScannedItemAtom);
  const hasFetched = useRef(false);

  /**
   * Fetch item data for this specific row
   */
  const fetchItem = useCallback(async () => {
    // Skip if we already have data or if we've already tried to fetch
    if (hasFetched.current || (item && (item.data || item.error))) {
      return;
    }

    // Mark as fetched to prevent duplicate fetches
    hasFetched.current = true;

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
  }, [qrId, item, setItem]);

  /** Fetch data when the component mounts */
  useEffect(() => {
    void fetchItem();
  }, [fetchItem]);

  // Determine if we should show the item or loading state
  // Only show the item if we have both data and type (complete item)
  const shouldShowItem = item && item.data && item.type && !item.error;

  return (
    <Tr>
      <Td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          {shouldShowItem
            ? renderItem(item.data as unknown as T)
            : renderLoading(qrId, item?.error)}
        </div>
      </Td>
      <Td>
        <Button
          className="border-none text-gray-500 hover:text-gray-700"
          variant="ghost"
          icon="trash"
          onClick={() => onRemove(qrId)}
        />
      </Td>
    </Tr>
  );
}

// Animation wrapper for rows
export function Tr({ children }: { children: React.ReactNode }) {
  return (
    <motion.tr
      initial={{ opacity: 0, y: -80 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      exit={{ opacity: 0 }}
      className="h-[80px] items-center border-b hover:bg-gray-50 [&_td]:border-b-0"
      style={{
        transform: "translateZ(0)",
        willChange: "transform",
        backgroundAttachment: "initial",
      }}
    >
      {children}
    </motion.tr>
  );
}

// Default loading state component
export function TextLoader({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return <div className={tw("loading-text", className)}>{text}...</div>;
}

export function DefaultLoadingState({
  qrId,
  error,
}: {
  qrId: string;
  error?: string;
}) {
  return (
    <div className="max-w-full">
      <p>
        QR id: <span className="font-semibold">{qrId}</span>
      </p>{" "}
      {error ? (
        <p className="whitespace-normal text-[12px] text-error-500">{error}</p>
      ) : (
        <TextLoader
          text="Fetching item"
          className="text-[10px] text-gray-500"
        />
      )}
    </div>
  );
}
