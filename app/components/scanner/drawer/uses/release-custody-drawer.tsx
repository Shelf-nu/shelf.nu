import { useState } from "react";
import { AssetStatus } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleX } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
  scannedItemIdsAtom,
} from "~/atoms/qr-scanner";
import { Form } from "~/components/custom-form";
import { CheckmarkIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { Spinner } from "~/components/shared/spinner";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import { useDisabled } from "~/hooks/use-disabled";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { ShelfError } from "~/utils/error";
import { objectToFormData } from "~/utils/object-to-form-data";
import { tw } from "~/utils/tw";
import {
  assetLabelPresets,
  createAvailabilityLabels,
  kitLabelPresets,
} from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import {
  GenericItemRow,
  DefaultLoadingState,
  TextLoader,
} from "../generic-item-row";

// Export the schema so it can be reused
export const ReleaseCustodyFromScannedItemsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

const BulkReleaseCustodySchema = z
  .object({
    assetIds: z.array(z.string()).optional().default([]),
    kitIds: z.array(z.string()).optional().default([]),
  })
  .refine((data) => data.assetIds.length > 0 || data.kitIds.length > 0, {
    message: "At least one asset or kit must be selected",
    path: ["assetIds"], // This will attach the error to the assetIds field
  });

type CustodyState = {
  assetStatus: "processing" | "success" | "error" | "skipped";
  assetErrorMessage?: string;
  kitStatus: "processing" | "success" | "error" | "skipped";
  kitErrorMessage?: string;
};

/**
 * Drawer component for managing scanned items to release from custody
 */
export default function ReleaseCustodyDrawer({
  className,
  style,
  isLoading,
  defaultExpanded = false,
}: {
  className?: string;
  style?: React.CSSProperties;
  isLoading?: boolean;
  defaultExpanded?: boolean;
}) {
  // Get the scanned items from jotai
  const items = useAtomValue(scannedItemsAtom);
  const clearList = useSetAtom(clearScannedItemsAtom);
  const removeItem = useSetAtom(removeScannedItemAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);

  // Filter and prepare data
  const assets = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data as AssetFromQr);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitFromQr);

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers - here we look for assets NOT in custody (AVAILABLE OF CHECKED_OUT)
  const assetsNotInCustody = assets
    .filter((asset) => !!asset && asset.status !== AssetStatus.IN_CUSTODY)
    .map((asset) => asset.id);

  // Asset is part of a kit
  const assetsArePartOfKit = assets
    .filter((asset) => !!asset && asset.kitId && asset.id)
    .map((asset) => asset.id);

  // Kit blockers
  // Kit is not in custody (AVAILABLE OF CHECKED_OUT)
  const kitsNotInCustody = kits
    .filter((kit) => kit.status !== AssetStatus.IN_CUSTODY)
    .map((kit) => kit.id);

  // Find the QR IDs that correspond to kit IDs with blockers
  // This is necessary because we need to remove the QR IDs from the items object, not the kit IDs
  const getQrIdsForKitIds = (kitIds: string[]) =>
    Object.entries(items)
      .filter(([, item]) => {
        if (!item || item.type !== "kit") return false;
        return kitIds.includes((item.data as KitFromQr)?.id);
      })
      .map(([qrId]) => qrId);

  // Get the QR IDs for each type of kit blocker
  const qrIdsOfKitsNotInCustody = getQrIdsForKitIds(kitsNotInCustody);

  // Create blockers configuration
  const blockerConfigs = [
    {
      condition: assetsNotInCustody.length > 0,
      count: assetsNotInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> not
          in custody.
        </>
      ),
      description: "Only assets in custody can be released.",
      onResolve: () => removeAssetsFromList(assetsNotInCustody),
    },
    {
      condition: assetsArePartOfKit.length > 0,
      count: assetsArePartOfKit.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s" : ""} `}</strong> are part
          of a kit.
        </>
      ),
      description: "Note: Scan Kit QR to release the full kit from custody",
      onResolve: () => removeAssetsFromList(assetsArePartOfKit),
    },
    {
      condition: qrIdsOfKitsNotInCustody.length > 0,
      count: qrIdsOfKitsNotInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong> not
          in custody.
        </>
      ),
      description: "Only kits in custody can be released.",
      onResolve: () => removeItemsFromList(qrIdsOfKitsNotInCustody),
    },
    {
      condition: errors.length > 0,
      count: errors.length,
      message: (count: number) => (
        <>
          <strong>{`${count} QR codes `}</strong> are invalid.
        </>
      ),
      onResolve: () => removeItemsFromList(errors.map(([qrId]) => qrId)),
    },
  ];

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll: () => {
      removeAssetsFromList([...assetsNotInCustody, ...assetsArePartOfKit]);
      removeItemsFromList([
        ...errors.map(([qrId]) => qrId),
        ...qrIdsOfKitsNotInCustody,
      ]);
    },
  });

  // Render item row
  const renderItemRow = (qrId: string, item: any) => (
    <GenericItemRow
      key={qrId}
      qrId={qrId}
      item={item}
      onRemove={removeItem}
      renderLoading={(qrId, error) => (
        <DefaultLoadingState qrId={qrId} error={error} />
      )}
      renderItem={(data) => {
        if (item?.type === "asset") {
          return <AssetRow asset={data as AssetFromQr} />;
        } else if (item?.type === "kit") {
          return <KitRow kit={data as KitFromQr} />;
        }
        return null;
      }}
    />
  );

  return (
    <ConfigurableDrawer
      schema={ReleaseCustodyFromScannedItemsSchema}
      items={items}
      onClearItems={clearList}
      title="Items scanned"
      isLoading={isLoading}
      renderItem={renderItemRow}
      Blockers={Blockers}
      defaultExpanded={defaultExpanded}
      className={className}
      style={style}
      form={<ReleaseCustodyForm disableSubmit={hasBlockers} />}
    />
  );
}

function ReleaseCustodyForm({ disableSubmit }: { disableSubmit: boolean }) {
  const { assetIds, kitIds, idsTotalCount } = useAtomValue(scannedItemIdsAtom);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [custodyState, setCustodyState] = useState<CustodyState>({
    assetStatus: "processing",
    kitStatus: "processing",
  });

  const disabled = useDisabled();

  const zo = useZorm("BulkReleaseCustody", BulkReleaseCustodySchema, {
    onValidSubmit: (e) => {
      e.preventDefault();
      setDialogOpen(true);
      const { assetIds, kitIds } = e.data;

      // Handle asset request
      if (assetIds && assetIds.length > 0) {
        // Create object data structure for assets
        const assetData = {
          assetIds,
        };

        // Convert to FormData
        const assetFormData = objectToFormData(assetData);

        // Send asset request
        fetch("/api/assets/bulk-release-custody", {
          method: "POST",
          body: assetFormData,
        })
          .then((response) => response.json())
          .then((data) => {
            setCustodyState((state) => ({
              ...state,
              assetStatus: data.error ? "error" : "success",
              ...(data.error && { assetErrorMessage: data.error.message }),
            }));
          })
          .catch((error) => {
            setCustodyState((state) => ({
              ...state,
              assetStatus: "error",
              assetErrorMessage:
                error instanceof ShelfError
                  ? error.message
                  : "Something went wrong while releasing custody. Please try again.",
            }));
          });
      } else {
        // No assets to process, mark as skipped
        setCustodyState((state) => ({
          ...state,
          assetStatus: "skipped",
        }));
      }

      // Handle kit request
      if (kitIds && kitIds.length > 0) {
        // Create object data structure for kits
        const kitData = {
          kitIds,
          intent: "bulk-release-custody",
        };

        // Convert to FormData
        const kitFormData = objectToFormData(kitData);

        // Send kit request
        fetch("/api/kits/bulk-actions", {
          method: "POST",
          body: kitFormData,
        })
          .then((response) => response.json())
          .then((data) => {
            setCustodyState((state) => ({
              ...state,
              kitStatus: data.error ? "error" : "success",
              ...(data.error && { kitErrorMessage: data.error.message }),
            }));
          })
          .catch((error) => {
            setCustodyState((state) => ({
              ...state,
              kitStatus: "error",
              kitErrorMessage:
                error instanceof ShelfError
                  ? error.message
                  : "Something went wrong while releasing custody. Please try again.",
            }));
          });
      } else {
        // No kits to process, mark as skipped
        setCustodyState((state) => ({
          ...state,
          kitStatus: "skipped",
        }));
      }
    },
  });

  const clearItems = useSetAtom(clearScannedItemsAtom);

  function cleanupState() {
    setCustodyState({
      assetStatus: "processing",
      kitStatus: "processing",
    });
    clearItems();
  }

  return (
    <>
      <SubmittingDialog
        open={dialogOpen}
        setOpen={setDialogOpen}
        custodyState={custodyState}
        cleanupState={cleanupState}
      />
      <Form ref={zo.ref}>
        {assetIds.map((id, index) => (
          <input
            key={`asset-${id}`}
            type="hidden"
            name={`assetIds[${index}]`}
            value={id}
          />
        ))}

        {kitIds.map((id, index) => (
          <input
            key={`kit-${id}`}
            type="hidden"
            name={`kitIds[${index}]`}
            value={id}
          />
        ))}

        <div className="px-4 md:pl-0">
          <div className={tw("mb-4 flex gap-3")}>
            <Button
              variant="primary"
              width="full"
              disabled={disabled || disableSubmit || idsTotalCount === 0}
            >
              Release custody
            </Button>
          </div>
        </div>
      </Form>
    </>
  );
}

// Implement item renderers if they're not already defined elsewhere
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  // Use predefined presets to create label configurations with appropriate conditions for release custody
  const availabilityConfigs = [
    // For release custody, we highlight assets that are NOT in custody (opposite of assign custody)
    {
      condition: asset.status !== AssetStatus.IN_CUSTODY,
      badgeText: "Not in custody",
      tooltipTitle: "Asset is not in custody",
      tooltipContent: "This asset is not in custody and cannot be released.",
      priority: 100,
    },
    assetLabelPresets.checkedOut(asset.status === AssetStatus.CHECKED_OUT),
    assetLabelPresets.partOfKit(!!asset.kitId),
  ];

  // Create the availability labels component with max 3 labels
  const [, AssetAvailabilityLabels] = createAvailabilityLabels(
    availabilityConfigs,
    {
      maxLabels: 3,
    }
  );

  return (
    <div className="flex flex-col gap-1">
      <p className="word-break whitespace-break-spaces font-medium">
        {asset.title}
      </p>

      <div className="flex flex-wrap items-center gap-1">
        <span
          className={tw(
            "inline-block bg-gray-50 px-[6px] py-[2px]",
            "rounded-md border border-gray-200",
            "text-xs text-gray-700"
          )}
        >
          asset
        </span>
        <AssetAvailabilityLabels />
        {asset.status === AssetStatus.IN_CUSTODY && asset.custody && (
          <span className="flex items-center gap-1">
            In custody of{" "}
            <TeamMemberBadge teamMember={asset?.custody?.custodian} />
          </span>
        )}
      </div>
    </div>
  );
}

export function KitRow({ kit }: { kit: KitFromQr }) {
  // Use predefined presets to create label configurations appropriate for release custody
  const availabilityConfigs = [
    // For release custody, we highlight kits that are NOT in custody (opposite of assign custody)
    {
      condition: kit.status !== AssetStatus.IN_CUSTODY,
      badgeText: "Not in custody",
      tooltipTitle: "Kit is not in custody",
      tooltipContent: "This kit is not in custody and cannot be released.",
      priority: 100,
    },
    kitLabelPresets.checkedOut(kit.status === AssetStatus.CHECKED_OUT),
  ];

  // Create the availability labels component with default options
  const [, KitAvailabilityLabels] = createAvailabilityLabels(
    availabilityConfigs,
    {
      maxLabels: 3,
    }
  );

  return (
    <div className="flex flex-col gap-1">
      <p className="word-break whitespace-break-spaces font-medium">
        {kit.name}{" "}
        <span className="text-[12px] font-normal text-gray-700">
          ({kit._count.assets} assets)
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={tw(
            "inline-block bg-gray-50 px-[6px] py-[2px]",
            "rounded-md border border-gray-200",
            "text-xs text-gray-700"
          )}
        >
          kit
        </span>
        <KitAvailabilityLabels />
        {kit.status === AssetStatus.IN_CUSTODY && kit.custody && (
          <span className="flex items-center gap-1">
            In custody of{" "}
            <TeamMemberBadge teamMember={kit?.custody?.custodian} />
          </span>
        )}
      </div>
    </div>
  );
}

function SubmittingDialog({
  open,
  setOpen,
  custodyState,
  cleanupState,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  custodyState: CustodyState;
  cleanupState: () => void;
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(newOpen) => {
        if (!newOpen) cleanupState();
        setOpen(newOpen);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Releasing custody</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-4">
              <SubmissionState
                type={"asset"}
                status={custodyState.assetStatus}
                errorMessage={custodyState?.assetErrorMessage}
              />
              <SubmissionState
                type={"kit"}
                status={custodyState.kitStatus}
                errorMessage={custodyState?.kitErrorMessage}
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary">Done</Button>
            </AlertDialogCancel>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function SubmissionState({
  type,
  status,
  errorMessage,
}: {
  type: "asset" | "kit";
  status: "processing" | "success" | "error" | "skipped";
  errorMessage?: string;
}) {
  // Return null for skipped status to hide the component entirely
  if (status === "skipped") {
    return null;
  }

  if (status === "processing") {
    return (
      <div className="flex flex-row gap-2">
        <Spinner />
        <TextLoader text={`Releasing custody from ${type}s`} />
      </div>
    );
  } else if (status === "success") {
    return (
      <div className="flex flex-row items-center gap-2 text-left">
        <span className="text-green-700">
          <CheckmarkIcon />
        </span>
        <div className="font-mono">
          {type === "asset" ? "Assets" : "Kits"} have been released from custody
        </div>
      </div>
    );
  } else if (status === "error") {
    return (
      <div>
        <div className="flex flex-row items-center gap-2 text-left">
          <CircleX className="size-[18px] text-error-500" />
          <div className="font-mono">
            Failed to release custody from {type}s.
          </div>
        </div>
        {errorMessage && (
          <span className="text-[12px] text-error-500">
            <strong>Error:</strong> {errorMessage}
          </span>
        )}
      </div>
    );
  }
}
