import { useState } from "react";
import type { CSSProperties } from "react";
import { AssetStatus, AssetType } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleX } from "lucide-react";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedAssetQuantitiesAtom,
  scannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
  scannedItemIdsAtom,
} from "~/atoms/qr-scanner";
import { Form } from "~/components/custom-form";
import { CheckmarkIcon } from "~/components/icons/library";
import {
  buildQuantitiesPayload,
  hasKitInheritedCustody,
  operatorHolderCount,
  releasableUnits,
} from "~/components/scanner/drawer/custody-scan-quantities";
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
import { useDisabled } from "~/hooks/use-disabled";
import { isQuantityTracked } from "~/modules/asset/utils";
import { getPrimaryCustody } from "~/modules/custody/utils";
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
import { ScannedAssetQuantityInput } from "../scanned-asset-quantity-input";

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
  style?: CSSProperties;
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

  // Asset blockers — assets NOT in custody (AVAILABLE or CHECKED_OUT).
  //
  // INDIVIDUAL only, matching the kit blocker below: `Asset.status` is one flag
  // for the whole row, so a quantity-tracked asset holding a partial custody
  // slice can read AVAILABLE (most units free) or CHECKED_OUT (some units out
  // on a booking) while units genuinely are in someone's hands. Blocking those
  // rows refuses a release that is legitimate; what can actually be released is
  // per custodian, which the server checks on the write.
  const assetsNotInCustody = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.status !== AssetStatus.IN_CUSTODY
    )
    .map((asset) => asset.id);

  /**
   * Quantity-tracked rows a release can never act on, split by why.
   *
   * A release scan names no custodian, so the route resolves the single
   * operator holder and refuses anything else. All of these reach that
   * refusal, and the first two reach it silently: a row with nothing
   * operator-held renders no quantity input, so it is submitted as a whole
   * asset and skipped with the rest of the quantity-tracked batch, reporting
   * success while doing nothing.
   *
   * "Held by the kit" and "held by nobody" are separated because the advice
   * differs — one is redirected to the kit's QR, the other has nothing to
   * release at all — and telling an operator to scan a kit for an asset that
   * simply is not in custody sends them looking for a kit that has it.
   */
  const qtyAssetsHeldViaKitOnly = assets
    .filter(
      (asset) =>
        !!asset &&
        isQuantityTracked(asset) &&
        operatorHolderCount(asset) === 0 &&
        hasKitInheritedCustody(asset)
    )
    .map((asset) => asset.id);

  const qtyAssetsWithNothingHeld = assets
    .filter(
      (asset) =>
        !!asset &&
        isQuantityTracked(asset) &&
        operatorHolderCount(asset) === 0 &&
        !hasKitInheritedCustody(asset)
    )
    .map((asset) => asset.id);

  const qtyAssetsWithSeveralHolders = assets
    .filter(
      (asset) =>
        !!asset && isQuantityTracked(asset) && operatorHolderCount(asset) > 1
    )
    .map((asset) => asset.id);

  // Asset is part of a kit. Only block INDIVIDUAL assets — qty-tracked
  // assets can have a partial-custody slice independent of any kit
  // allocation, so a kit membership shouldn't prevent releasing
  // operator-only custody.
  const assetsArePartOfKit = assets
    .filter(
      (asset) =>
        !!asset &&
        asset.type === AssetType.INDIVIDUAL &&
        asset.assetKits.length > 0 &&
        asset.id
    )
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
      condition: qtyAssetsHeldViaKitOnly.length > 0,
      count: qtyAssetsHeldViaKitOnly.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> held
          through a kit.
        </>
      ),
      description: "Scan the kit's QR to release the whole kit from custody.",
      onResolve: () => removeAssetsFromList(qtyAssetsHeldViaKitOnly),
    },
    {
      condition: qtyAssetsWithNothingHeld.length > 0,
      count: qtyAssetsWithNothingHeld.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s have" : " has"}`}</strong> no
          units in custody.
        </>
      ),
      description: "There is nothing to release for them.",
      onResolve: () => removeAssetsFromList(qtyAssetsWithNothingHeld),
    },
    {
      condition: qtyAssetsWithSeveralHolders.length > 0,
      count: qtyAssetsWithSeveralHolders.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong> held
          by more than one person.
        </>
      ),
      description:
        "Release these from the asset's custody list, where each holder is listed separately.",
      onResolve: () => removeAssetsFromList(qtyAssetsWithSeveralHolders),
    },
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
      removeAssetsFromList([
        ...qtyAssetsHeldViaKitOnly,
        ...qtyAssetsWithNothingHeld,
        ...qtyAssetsWithSeveralHolders,
        ...assetsNotInCustody,
        ...assetsArePartOfKit,
      ]);
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
  // Per-row units for quantity-tracked scans, written by
  // `ScannedAssetQuantityInput` and keyed by asset id.
  const assetQuantities = useAtomValue(scannedAssetQuantitiesAtom);
  // The scanned rows themselves — the submit sends a quantity for every
  // quantity-tracked row, not only the ones whose input was edited.
  const items = useAtomValue(scannedItemsAtom);

  const zo = useZorm("BulkReleaseCustody", BulkReleaseCustodySchema, {
    onValidSubmit: (e) => {
      e.preventDefault();
      setDialogOpen(true);
      const { assetIds, kitIds } = e.data;

      // Handle asset request
      if (assetIds && assetIds.length > 0) {
        const quantities = JSON.stringify(
          buildQuantitiesPayload({
            items,
            assetIds,
            assetQuantities,
            unitsFor: releasableUnits,
          })
        );
        // Create object data structure for assets
        const assetData = {
          assetIds,
          quantities,
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
              type="submit"
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
  const qtyTracked = isQuantityTracked(asset);
  const inCustody = releasableUnits(asset);
  // Use predefined presets to create label configurations with appropriate conditions for release custody
  const availabilityConfigs = [
    {
      condition: asset.status === AssetStatus.IN_CUSTODY,
      badgeText: `In custody of: ${getPrimaryCustody(asset.custody)?.custodian
        ?.name}`,
      tooltipTitle: "Asset is in custody",
      tooltipContent: `This asset is in custody of ${getPrimaryCustody(
        asset.custody
      )?.custodian?.name}.`,
      priority: 110,
      className: "bg-gray-50 border-gray-200 text-gray-700",
    },
    // For release custody, we highlight assets that are NOT in custody (opposite of assign custody)
    {
      // Whole-asset statement, so INDIVIDUAL only — a qty-tracked row can hold
      // units for someone while its overall status reads otherwise.
      condition:
        asset.type === AssetType.INDIVIDUAL &&
        asset.status !== AssetStatus.IN_CUSTODY,
      badgeText: "Not in custody",
      tooltipTitle: "Asset is not in custody",
      tooltipContent: "This asset is not in custody and cannot be released.",
      priority: 100,
    },
    assetLabelPresets.checkedOut(asset.status === AssetStatus.CHECKED_OUT),
    assetLabelPresets.partOfKit(
      asset.assetKits.length > 0,
      isQuantityTracked(asset)
    ),
  ];

  // Create the availability labels component with max 3 labels
  const [, AssetAvailabilityLabels] = createAvailabilityLabels(
    availabilityConfigs,
    {
      maxLabels: 3,
    }
  );

  return (
    <div className="flex w-full items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
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
        </div>
      </div>

      {/* Quantity-tracked rows hand back a number of units, not the whole
          item. Hidden when nothing is held — there is nothing to release. */}
      {qtyTracked && inCustody > 0 ? (
        <ScannedAssetQuantityInput
          assetId={asset.id}
          max={inCustody}
          unit={asset.unitOfMeasure || "units"}
        />
      ) : null}
    </div>
  );
}

export function KitRow({ kit }: { kit: KitFromQr }) {
  // Use predefined presets to create label configurations appropriate for release custody
  const availabilityConfigs = [
    {
      condition: kit.status === AssetStatus.IN_CUSTODY,
      badgeText: `In custody of: ${kit.custody?.custodian?.name}`,
      tooltipTitle: "Kit is in custody",
      tooltipContent: `This kit is in custody of ${kit.custody?.custodian?.name}.`,
      priority: 110,
      className: "bg-gray-50 border-gray-200 text-gray-700",
    },
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
          ({kit._count.assetKits} assets)
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
              <Button type="button" variant="secondary">
                Done
              </Button>
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
