import { useState } from "react";
import type { CSSProperties } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleX } from "lucide-react";
import { useZorm } from "react-zorm";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  removeMultipleScannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  scannedItemIdsAtom,
} from "~/atoms/qr-scanner";
import { BulkLocationUpdateSchema } from "~/components/assets/bulk-location-update-dialog";
import { Form } from "~/components/custom-form";
import { CheckmarkIcon } from "~/components/icons/library";
import { LocationSelect } from "~/components/location/location-select";
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
import type { BulkPartStatuses } from "~/hooks/use-bulk-save-settle";
import { useBulkSaveSettle } from "~/hooks/use-bulk-save-settle";
import { useDisabled } from "~/hooks/use-disabled";
import { getPrimaryLocation } from "~/modules/asset/utils";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { ShelfError } from "~/utils/error";
import { objectToFormData } from "~/utils/object-to-form-data";
import { readBulkSaveAnswer } from "~/utils/scan-submit-failure";
import { tw } from "~/utils/tw";
import {
  createAvailabilityLabels,
  assetLabelPresets,
} from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import {
  GenericItemRow,
  DefaultLoadingState,
  TextLoader,
} from "../generic-item-row";
import { buildUpdateLocationBlockers } from "./location-scan-blockers";
import type { LocationState } from "./update-location-result";
import { foldLocationPart } from "./update-location-result";

/**
 * Drawer component for managing scanned assets to be added to a location
 */
export default function UpdateLocationDrawer({
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
  const removeItemsFromList = useSetAtom(removeMultipleScannedItemsAtom);
  const removeAssetsFromList = useSetAtom(removeScannedItemsByAssetIdAtom);

  const { blockerConfigs } = buildUpdateLocationBlockers({
    items,
    removeAssetsFromList,
    removeItemsFromList,
  });

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
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
      schema={BulkLocationUpdateSchema}
      items={items}
      onClearItems={clearList}
      title="Items scanned"
      isLoading={isLoading}
      renderItem={renderItemRow}
      Blockers={Blockers}
      defaultExpanded={defaultExpanded}
      className={className}
      style={style}
      form={<AddToLocationForm disableSubmit={hasBlockers} />}
    />
  );
}

/** The result the dialog shows, and where each part of the save stands. */
type LocationSave = { result: LocationState; parts: BulkPartStatuses };

/** Before a save, and after its dialog is closed. */
const PENDING_LOCATION_SAVE: LocationSave = {
  result: { status: "processing" },
  parts: { assets: "processing", kits: "processing" },
};

function AddToLocationForm({ disableSubmit }: { disableSubmit: boolean }) {
  const { assetIds, idsTotalCount, kitIds } = useAtomValue(scannedItemIdsAtom);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [save, setSave] = useState<LocationSave>(PENDING_LOCATION_SAVE);
  const disabled = useDisabled();
  // What the list keeps once the save answers, and the draft's mark.
  const bulkSave = useBulkSaveSettle({ statuses: save.parts, dialogOpen });

  const zo = useZorm("AddToLocation", BulkLocationUpdateSchema, {
    onValidSubmit: async (e) => {
      e.preventDefault();
      setDialogOpen(true);
      const { assetIds, newLocationId, kitIds } = e.data;

      // Skip if no assets or no kitIds to process
      if (assetIds.length === 0 && kitIds.length === 0) {
        setSave({
          ...PENDING_LOCATION_SAVE,
          result: {
            status: "error",
            errorMessage: "No assets or kits selected to update location",
          },
        });
        return;
      }

      const attempt = bulkSave.begin({ assetIds, kitIds });
      const show = (next: LocationSave) => {
        if (attempt.isCurrent()) {
          setSave(next);
        }
      };
      // The result is shown once every part has answered. Each part's status
      // is shown as soon as it answers, so Done pressed while the kits are
      // still waiting takes the saved assets out of the list.
      let result: LocationState = { status: "processing" };
      let parts: BulkPartStatuses = {
        assets: assetIds.length ? "processing" : "skipped",
        kits: kitIds.length ? "processing" : "skipped",
      };
      show({ result, parts });

      try {
        if (assetIds.length) {
          const formData = objectToFormData({
            assetIds,
            newLocationId,
          });
          const assetsResponse = await fetch(
            "/api/assets/bulk-update-location",
            {
              method: "POST",
              body: formData,
            }
          );
          const assetsData = await readBulkSaveAnswer<{
            error?: { message: string };
          }>(assetsResponse);
          result = foldLocationPart(result, assetsData);
          parts = { ...parts, assets: assetsData.error ? "error" : "success" };
          if (kitIds.length) {
            show({ result: { status: "processing" }, parts });
          }
        }

        if (kitIds.length) {
          const kitFormData = objectToFormData({
            kitIds,
            newLocationId,
            intent: "bulk-update-location",
          });

          const kitsResponse = await fetch("/api/kits/bulk-actions", {
            method: "POST",
            body: kitFormData,
          });
          const kitsData = await readBulkSaveAnswer<{
            error?: { message: string };
          }>(kitsResponse);
          result = foldLocationPart(result, kitsData);
          parts = { ...parts, kits: kitsData.error ? "error" : "success" };
        }

        show({ result, parts });
      } catch (error) {
        // No answer: the server may have saved it anyway, so the mark stays.
        // A part that was never sent is not saved either.
        attempt.markUnanswered();
        show({
          result: {
            status: "error",
            errorMessage:
              error instanceof ShelfError
                ? error.message
                : "Something went wrong while adding assets/kit to location. Please try again.",
          },
          parts: {
            assets: parts.assets === "processing" ? "error" : parts.assets,
            kits: parts.kits === "processing" ? "error" : parts.kits,
          },
        });
      }
    },
  });

  function cleanupState() {
    // Empties the list only when the whole of it saved; see `dismissBulkSave`.
    bulkSave.dismiss();
    setSave(PENDING_LOCATION_SAVE);
  }

  return (
    <>
      <SubmittingDialog
        open={dialogOpen}
        setOpen={setDialogOpen}
        locationState={save.result}
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
          <div className="relative z-50 mb-3 mt-2">
            <h5 className="mb-1">Update location:</h5>
            <LocationSelect
              isBulk
              hideClearButton
              placeholder="Select location"
            />
            {zo.errors.newLocationId()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.newLocationId()?.message}
              </p>
            ) : null}
          </div>

          <div className="mb-2 flex gap-3">
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled || disableSubmit || idsTotalCount === 0}
            >
              Update location
            </Button>
          </div>
        </div>
      </Form>
    </>
  );
}

// Implement item renderers
export function AssetRow({ asset }: { asset: AssetFromQr }) {
  const primaryLocation = getPrimaryLocation(asset);

  // Use predefined presets to create label configurations for asset rows
  const availabilityConfigs = [
    assetLabelPresets.archived(!!asset.archivedAt),
    ...(primaryLocation
      ? [
          {
            condition: true,
            badgeText: `Currently in: ${primaryLocation.name}`,
            tooltipTitle: "Current Location",
            tooltipContent: `Asset is currently located in ${primaryLocation.name}`,
            priority: 60,
            className: "bg-gray-50 border-gray-200 text-gray-700",
          },
        ]
      : []),
  ];

  // Create the availability labels component
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
      </div>
    </div>
  );
}

export function KitRow({ kit }: { kit: KitFromQr }) {
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
      </div>
    </div>
  );
}

function SubmittingDialog({
  open,
  setOpen,
  locationState,
  cleanupState,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  locationState: LocationState;
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
          <AlertDialogTitle>Adding to location</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-4">
              <SubmissionState
                status={locationState.status}
                errorMessage={locationState?.errorMessage}
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
  status,
  errorMessage,
}: {
  status: "processing" | "success" | "error";
  errorMessage?: string;
}) {
  if (status === "processing") {
    return (
      <div className="flex flex-row gap-2">
        <Spinner />
        <TextLoader text="Adding assets/kit to location" />
      </div>
    );
  } else if (status === "success") {
    return (
      <div className="flex flex-row items-center gap-2 text-left">
        <span className="text-green-700">
          <CheckmarkIcon />
        </span>
        <div className="font-mono">
          Assets/kit successfully added to location
        </div>
      </div>
    );
  } else if (status === "error") {
    return (
      <div>
        <div className="flex flex-row items-center gap-2 text-left">
          <CircleX className="size-[18px] text-error-500" />
          <div className="font-mono">Failed to add assets/kit to location</div>
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
