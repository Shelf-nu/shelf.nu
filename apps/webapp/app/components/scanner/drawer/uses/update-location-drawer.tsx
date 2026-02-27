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
import { useDisabled } from "~/hooks/use-disabled";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { ShelfError } from "~/utils/error";
import { objectToFormData } from "~/utils/object-to-form-data";
import { tw } from "~/utils/tw";
import { createAvailabilityLabels } from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import {
  GenericItemRow,
  DefaultLoadingState,
  TextLoader,
} from "../generic-item-row";

type LocationState = {
  status: "processing" | "success" | "error";
  errorMessage?: string;
};

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

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Create blockers configuration
  const blockerConfigs = [
    {
      condition: errors.length > 0,
      count: errors.length,
      message: (count: number) => (
        <>
          <strong>{`${count} QR code${count > 1 ? "s" : ""}`}</strong> $
          {count > 1 ? "are" : "is"} invalid.
        </>
      ),
      onResolve: () => removeItemsFromList(errors.map(([qrId]) => qrId)),
    },
  ];

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll: () => {
      removeItemsFromList([...errors.map(([qrId]) => qrId)]);
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

function AddToLocationForm({ disableSubmit }: { disableSubmit: boolean }) {
  const { assetIds, idsTotalCount, kitIds } = useAtomValue(scannedItemIdsAtom);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>({
    status: "processing",
  });
  const disabled = useDisabled();

  const zo = useZorm("AddToLocation", BulkLocationUpdateSchema, {
    onValidSubmit: async (e) => {
      e.preventDefault();
      setDialogOpen(true);
      const { assetIds, newLocationId, kitIds } = e.data;

      // Skip if no assets or no kitIds to process
      if (assetIds.length === 0 && kitIds.length === 0) {
        setLocationState({
          status: "error",
          errorMessage: "No assets or kits selected to update location",
        });
        return;
      }

      try {
        let locationState: LocationState = { status: "processing" };

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
          const assetsData = await assetsResponse.json();
          locationState = {
            status: assetsData.error ? "error" : "success",
            ...(assetsData.error && { errorMessage: assetsData.error.message }),
          };
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
          const kitsData = await kitsResponse.json();
          locationState = {
            status: kitsData.error ? "error" : "success",
            ...(kitsData.error && { errorMessage: kitsData.error.message }),
          };
        }

        setLocationState(locationState);
      } catch (error) {
        setLocationState({
          status: "error",
          errorMessage:
            error instanceof ShelfError
              ? error.message
              : "Something went wrong while adding assets/kit to location. Please try again.",
        });
      }
    },
  });

  const clearItems = useSetAtom(clearScannedItemsAtom);

  function cleanupState() {
    setLocationState({
      status: "processing",
    });
    clearItems();
  }

  return (
    <>
      <SubmittingDialog
        open={dialogOpen}
        setOpen={setDialogOpen}
        locationState={locationState}
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
          <div className="relative z-50 my-8">
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

          <div className="mb-4 flex gap-3">
            <Button
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
  // Use predefined presets to create label configurations for asset rows
  const availabilityConfigs = [
    ...(asset.location
      ? [
          {
            condition: true,
            badgeText: `Currently in: ${asset.location.name}`,
            tooltipTitle: "Current Location",
            tooltipContent: `Asset is currently located in ${asset.location.name}`,
            priority: 60,
            className: "bg-color-50 border-color-200 text-color-700",
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
            "inline-block bg-color-50 px-[6px] py-[2px]",
            "rounded-md border border-color-200",
            "text-xs text-color-700"
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
        <span className="text-[12px] font-normal text-color-700">
          ({kit._count.assets} assets)
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span
          className={tw(
            "inline-block bg-color-50 px-[6px] py-[2px]",
            "rounded-md border border-color-200",
            "text-xs text-color-700"
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
              <Button variant="secondary">Done</Button>
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
