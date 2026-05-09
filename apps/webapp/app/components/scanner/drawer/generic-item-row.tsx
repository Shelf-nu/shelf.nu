import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import type { Prisma } from "@prisma/client";
import { m } from "framer-motion";
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
  renderItem: (item: T) => ReactNode;
  renderLoading: (qrId: string, error?: string) => ReactNode;
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
  /**
   * Optional additional search params to be sent to the get-scanned-item endpoint
   */
  searchParams?: Record<string, string>;
  /** Optional className to apply to the row wrapper (Tr) */
  className?: string;
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
  searchParams: additionalSearchParams,
  className: rowClassName,
}: GenericItemRowProps<T>) {
  const setItem = useSetAtom(updateScannedItemAtom);

  // Track if item had data on initial mount (restored from DB)
  // to skip entrance animation and prevent list jumping on route changes
  const hadDataOnMountRef = useRef(!!item?.data);

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
  // Add any additional search params
  if (additionalSearchParams) {
    Object.entries(additionalSearchParams).forEach(([key, value]) => {
      searchParams.append(key, value);
    });
  }

  // Determine which API to call based on codeType
  const isBarcode = item?.codeType === "barcode";
  const apiEndpoint = isBarcode
    ? `/api/get-scanned-barcode/${encodeURIComponent(qrId)}`
    : `/api/get-scanned-item/${qrId}`;

  // Keep codeType in a ref so onSuccess doesn't need to re-run when item changes.
  const codeTypeRef = useRef(item?.codeType);
  codeTypeRef.current = item?.codeType;

  /**
   * Handle the API response. Runs directly from useApiQuery's onSuccess
   * callback instead of a useEffect so it fires exactly once per fetch.
   */
  const handleApiSuccess = useCallback(
    (apiResponse: ApiResponse) => {
      if (apiResponse.error) {
        setItem({
          qrId,
          item: { error: apiResponse.error.message },
        });
        return;
      }

      const dataSource = isBarcode
        ? (apiResponse as BarcodeApiResponse).barcode
        : (apiResponse as QrApiResponse).qr;

      if (dataSource && dataSource.type === "asset") {
        const itemWithType: ScanListItem = {
          data: dataSource.asset,
          type: "asset",
          codeType: codeTypeRef.current,
        };
        if (itemWithType.data) {
          setItem({ qrId, item: itemWithType });
        }
      } else if (dataSource && dataSource.type === "kit") {
        const itemWithType: ScanListItem = {
          data: dataSource.kit,
          type: "kit",
          codeType: codeTypeRef.current,
        };
        if (itemWithType.data) {
          setItem({ qrId, item: itemWithType });
        }
      }
    },
    [isBarcode, qrId, setItem]
  );

  /**
   * Handle fetch errors via the hook's onError callback rather than a
   * follow-up useEffect that would otherwise fire as a reactive listener.
   */
  const handleApiError = useCallback(() => {
    setItem({
      qrId,
      item: { error: "Failed to fetch item" },
    });
  }, [qrId, setItem]);

  // Use the API hook to fetch item data
  const { error: fetchError } = useApiQuery<ApiResponse>({
    api: apiEndpoint,
    searchParams,
    enabled: shouldFetch,
    onSuccess: handleApiSuccess,
    onError: handleApiError,
  });

  // Determine if we should show the item or loading state
  // Only show the item if we have both data and type (complete item)
  const shouldShowItem = item && item.data && item.type && !item.error;

  // Determine the current state for better loading UX
  const currentError =
    item?.error || (fetchError ? "Failed to fetch item" : undefined);

  return (
    <Tr skipEntrance={hadDataOnMountRef.current} className={rowClassName}>
      <Td className="w-full p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:px-6">
          {shouldShowItem
            ? renderItem(item.data as unknown as T)
            : renderLoading(qrId, currentError)}
        </div>
      </Td>
      <Td>
        <Button
          type="button"
          className="border-none text-gray-500 hover:text-gray-700"
          variant="ghost"
          icon="trash"
          onClick={() => onRemove(qrId)}
          aria-label={
            item?.data && "title" in item.data
              ? `Remove scanned item: ${item.data.title}`
              : item?.data && "name" in item.data
                ? `Remove scanned item: ${item.data.name}`
                : "Remove scanned item"
          }
        />
      </Td>
    </Tr>
  );
}

/**
 * Base style for the animated row. Kept at module scope so the reference
 * is stable across renders.
 */
const TR_BASE_STYLE = {
  transform: "translateZ(0)",
  backgroundAttachment: "initial",
} as const;

// Animation wrapper for rows
export function Tr({
  children,
  skipEntrance = false,
  className,
}: {
  children: ReactNode;
  /** Skip entrance animation for items restored from DB to prevent jumping on route changes */
  skipEntrance?: boolean;
  className?: string;
}) {
  // Only hint the compositor to promote this row while the entrance/exit
  // animation is actually running, so we don't leave will-change set
  // permanently (which wastes GPU memory and can degrade performance).
  const [isAnimating, setIsAnimating] = useState(!skipEntrance);

  const style = isAnimating
    ? { ...TR_BASE_STYLE, willChange: "transform" }
    : TR_BASE_STYLE;

  return (
    <m.tr
      initial={skipEntrance ? false : { opacity: 0, y: -80 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      exit={{ opacity: 0 }}
      onAnimationStart={() => setIsAnimating(true)}
      onAnimationComplete={() => setIsAnimating(false)}
      className={tw(
        "h-[80px] items-center border-b hover:bg-gray-50 [&_td]:border-b-0",
        className
      )}
      style={style}
    >
      {children}
    </m.tr>
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
          className="text-[10px] text-gray-500"
        />
      )}
    </div>
  );
}
