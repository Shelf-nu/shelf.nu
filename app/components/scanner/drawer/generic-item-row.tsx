import { useEffect } from "react";
import type { Prisma } from "@prisma/client";
import { motion } from "framer-motion";
import { useSetAtom } from "jotai";
import type { ScanListItem } from "~/atoms/qr-scanner";
import { updateScannedItemAtom } from "~/atoms/qr-scanner";
import { Button } from "~/components/shared/button";
import { Td } from "~/components/table";
import useApiQuery from "~/hooks/use-api-query";
import type {
  AssetFromBarcode,
  KitFromBarcode,
} from "~/routes/api+/get-scanned-barcode.$value";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { tw } from "~/utils/tw";

// Type for the QR API response
type QrApiResponse = {
  error?: { message: string };
  qr?: {
    type: "asset" | "kit";
    asset?: AssetFromQr & {
      [key: string]: any; // Extend with any additional fields you need
    };
    kit?: KitFromQr & {
      [key: string]: any; // Extend with any additional fields you need
    };
  };
};

// Type for the Barcode API response
type BarcodeApiResponse = {
  error?: { message: string };
  barcode?: {
    type: "asset" | "kit";
    asset?: AssetFromBarcode & {
      [key: string]: any; // Extend with any additional fields you need
    };
    kit?: KitFromBarcode & {
      [key: string]: any; // Extend with any additional fields you need
    };
  };
};

// Union type for both responses
type ApiResponse = QrApiResponse | BarcodeApiResponse;

// Type for the row props
type GenericItemRowProps<T> = {
  qrId: string;
  item: ScanListItem | undefined;
  onRemove: (qrId: string) => void;
  renderItem: (item: T) => React.ReactNode;
  renderLoading: (qrId: string, error?: string) => React.ReactNode;
  /**
   * Optional array of strings to be sent as search params to the get-scanned-item endpoint
   * This can allow for additional data to be fetched or included in the asset request for better UX
   * The strings inside the array should be a json representation of prisma's include/select syntax,
   */
  assetExtraInclude?: Prisma.AssetInclude;
  /**
   * Optional array of strings to be sent as search params to the get-scanned-item endpoint
   * This can allow for additional data to be fetched or included in the kit request for better UX
   * The strings inside the array should be a json representation of prisma's include/select syntax,
   */
  kitExtraInclude?: Prisma.KitInclude;
};

/**
 * Generic component for rendering a row in the scanned items table
 * With self-contained fetch functionality using useApiQuery hook
 */
export function GenericItemRow<T>({
  qrId,
  item,
  onRemove,
  renderItem,
  renderLoading,
  assetExtraInclude,
  kitExtraInclude,
}: GenericItemRowProps<T>) {
  const setItem = useSetAtom(updateScannedItemAtom);

  // Determine if we should fetch - only if we don't already have data or error
  const shouldFetch = !(item && (item.data || item.error));
  const searchParams = new URLSearchParams();
  // Add asset extra include if provided
  if (assetExtraInclude) {
    searchParams.append("assetExtraInclude", JSON.stringify(assetExtraInclude));
  }
  // Add kit extra include if provided
  if (kitExtraInclude) {
    searchParams.append("kitExtraInclude", JSON.stringify(kitExtraInclude));
  }

  // Determine which API to call based on codeType
  const isBarcode = item?.codeType === "barcode";
  const apiEndpoint = isBarcode
    ? `/api/get-scanned-barcode/${encodeURIComponent(qrId)}`
    : `/api/get-scanned-item/${qrId}`;

  // Use the API hook to fetch item data
  const { data: response, error: fetchError } = useApiQuery<ApiResponse>({
    api: apiEndpoint,
    searchParams,
    enabled: shouldFetch,
  });

  // Process the response when it changes
  useEffect(() => {
    if (response) {
      // If the server returns an error, add it to the item and return
      if (response.error) {
        setItem({
          qrId,
          item: { error: response.error.message },
        });
        return;
      }

      // Handle both QR and barcode responses
      const dataSource = isBarcode
        ? (response as BarcodeApiResponse).barcode
        : (response as QrApiResponse).qr;

      // Determine item type (asset or kit) and update accordingly
      if (dataSource && dataSource.type === "asset") {
        const itemWithType: ScanListItem = {
          data: dataSource.asset,
          type: "asset",
          codeType: item?.codeType,
        };
        if (itemWithType.data) {
          setItem({
            qrId,
            item: itemWithType,
          });
        }
      } else if (dataSource && dataSource.type === "kit") {
        const itemWithType: ScanListItem = {
          data: dataSource.kit,
          type: "kit",
          codeType: item?.codeType,
        };
        if (itemWithType.data) {
          setItem({
            qrId,
            item: itemWithType,
          });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [response, qrId, setItem]);

  // Handle fetch errors
  useEffect(() => {
    if (fetchError) {
      setItem({
        qrId,
        item: { error: "Failed to fetch item" },
      });
    }
  }, [fetchError, qrId, setItem]);

  // Determine if we should show the item or loading state
  // Only show the item if we have both data and type (complete item)
  const shouldShowItem = item && item.data && item.type && !item.error;

  // Determine the current state for better loading UX
  const currentError =
    item?.error || (fetchError ? "Failed to fetch item" : undefined);

  return (
    <Tr>
      <Td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          {shouldShowItem
            ? renderItem(item.data as unknown as T)
            : renderLoading(qrId, currentError)}
        </div>
      </Td>
      <Td>
        <Button
          className="border-none text-color-500 hover:text-color-700"
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
      className="h-[80px] items-center border-b hover:bg-color-50 [&_td]:border-b-0"
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
        Code: <span className="font-semibold">{qrId}</span>
      </p>{" "}
      {error ? (
        <p className="whitespace-normal text-[12px] text-error-500">{error}</p>
      ) : (
        <TextLoader
          text="Fetching item"
          className="text-[10px] text-color-500"
        />
      )}
    </div>
  );
}
