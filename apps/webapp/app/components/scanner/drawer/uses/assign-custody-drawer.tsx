import { useState } from "react";
import type { CSSProperties } from "react";
import { AssetStatus } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleX } from "lucide-react";
import { useLoaderData } from "react-router";
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
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { CheckmarkIcon } from "~/components/icons/library";
import {
  assignableUnits,
  buildQuantitiesPayload,
  shouldShowStateBadges,
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
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isQuantityTracked } from "~/modules/asset/utils";
import { createCustodianSchema } from "~/modules/custody/schema";
import type { ScannerLoader } from "~/routes/_layout+/scanner";
import type {
  AssetFromQr,
  KitFromQr,
} from "~/routes/api+/get-scanned-item.$qrId";
import { ShelfError } from "~/utils/error";
import { objectToFormData } from "~/utils/object-to-form-data";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import {
  assetLabelPresets,
  createAvailabilityLabels,
  kitLabelPresets,
} from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import { buildAssignCustodyBlockers } from "./custody-blockers";
import ConfigurableDrawer from "../configurable-drawer";
import {
  GenericItemRow,
  DefaultLoadingState,
  TextLoader,
} from "../generic-item-row";
import { ScannedAssetQuantityInput } from "../scanned-asset-quantity-input";

// Export the schema so it can be reused
export const AssignCustodyToSignedItemsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

const BulkAssignCustodySchema = z
  .object({
    assetIds: z.array(z.string()).optional().default([]),
    kitIds: z.array(z.string()).optional().default([]),
    custodian: createCustodianSchema(),
  })
  .refine((data) => data.assetIds.length > 0 || data.kitIds.length > 0, {
    message: "At least one asset or kit must be selected",
    path: ["assetIds"], // This will attach the error to the assetIds field
  });

/**
 * Drawer component for assigning custody to scanned assets and kits
 */
export default function AssignCustodyDrawer({
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

  // Blockers live in `custody-blockers` so the list is a pure function of the
  // scanned rows and can be tested without mounting this drawer.
  const { blockerConfigs, onResolveAll } = buildAssignCustodyBlockers({
    items,
    removeAssetsFromList,
    removeItemsFromList,
  });

  // Create blockers component
  const [hasBlockers, Blockers] = createBlockers({
    blockerConfigs,
    onResolveAll,
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
        if (item?.type === "asset" && data) {
          return <AssetRow asset={data as AssetFromQr} />;
        } else if (item?.type === "kit" && data) {
          return <KitRow kit={data as KitFromQr} />;
        }
        return null;
      }}
      // Custody context so the API attaches `pickerMeta` with the pool
      // `checkOutQuantity` enforces, the ceiling the qty input below is
      // bounded by. No id: the custodian is chosen after scanning and the pool
      // does not depend on who ends up holding the units.
      searchParams={{ pickerContext: JSON.stringify({ type: "custody" }) }}
    />
  );

  return (
    <ConfigurableDrawer
      schema={AssignCustodyToSignedItemsSchema}
      items={items}
      onClearItems={clearList}
      title="Items scanned"
      isLoading={isLoading}
      renderItem={renderItemRow}
      Blockers={Blockers}
      defaultExpanded={defaultExpanded}
      className={className}
      style={style}
      form={<CustodyForm disableSubmit={hasBlockers} />}
    />
  );
}

type CustodyState = {
  assetStatus: "processing" | "success" | "error" | "skipped";
  assetErrorMessage?: string;
  kitStatus: "processing" | "success" | "error" | "skipped";
  kitErrorMessage?: string;
  custodianName: string;
};

function CustodyForm({ disableSubmit }: { disableSubmit: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [custodyState, setCustodyState] = useState<CustodyState>({
    assetStatus: "processing",
    kitStatus: "processing",
    custodianName: "",
  });
  const disabled = useDisabled();
  const { isSelfService } = useUserRoleHelper();
  const { teamMembers } = useLoaderData<ScannerLoader>();
  // Per-row units for quantity-tracked scans, written by
  // `ScannedAssetQuantityInput` and keyed by asset id.
  const assetQuantities = useAtomValue(scannedAssetQuantitiesAtom);
  // The scanned rows themselves. The submit sends a quantity for every
  // quantity-tracked row, not only the ones whose input was edited.
  const items = useAtomValue(scannedItemsAtom);
  const zo = useZorm("BulkAssignCustody", BulkAssignCustodySchema, {
    onValidSubmit: (e) => {
      e.preventDefault();
      setDialogOpen(true);
      const { custodian, assetIds, kitIds } = e.data;
      setCustodyState((state) => ({
        ...state,
        custodianName: custodian.name,
      }));

      // Handle asset request
      if (assetIds && assetIds.length > 0) {
        const quantities = JSON.stringify(
          buildQuantitiesPayload({
            items,
            assetIds,
            assetQuantities,
            unitsFor: assignableUnits,
          })
        );

        // Create object data structure for assets
        const assetData = {
          custodian,
          assetIds,
          quantities,
        };

        // Convert to FormData
        const assetFormData = objectToFormData(assetData, {
          jsonStringifyFields: ["custodian"],
        });

        // Send asset request
        fetch("/api/assets/bulk-assign-custody", {
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
                  : "Something went wrong while assigning custody. Please try again.",
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
          custodian,
          kitIds,
          intent: "bulk-assign-custody",
        };

        // Convert to FormData
        const kitFormData = objectToFormData(kitData, {
          jsonStringifyFields: ["custodian"],
        });

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
                  : "Something went wrong while assigning custody. Please try again.",
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

  const { assetIds, kitIds, idsTotalCount } = useAtomValue(scannedItemIdsAtom);

  const clearItems = useSetAtom(clearScannedItemsAtom);

  function cleanupState() {
    setCustodyState({
      assetStatus: "processing",
      kitStatus: "processing",
      custodianName: "",
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
          <div className="relative z-50 my-8 ">
            <h5 className="mb-1">Assign custody to:</h5>
            <DynamicSelect
              defaultValue={
                isSelfService && teamMembers?.length > 0
                  ? JSON.stringify({
                      id: teamMembers[0].id,
                      name: resolveTeamMemberName(teamMembers[0]),
                    })
                  : undefined
              }
              disabled={disabled || isSelfService}
              model={{
                name: "teamMember",
                queryKey: "name",
                deletedAt: null,
                // ASSET custody: SELF_SERVICE may only take custody itself and
                // BASE never. Matches the scanner loader's seed, which resolves
                // the same purpose server-side.
                custodyPurpose: "custody-assignment",
              }}
              fieldName="custodian"
              contentLabel="Team members"
              initialDataKey="teamMembers"
              countKey="totalTeamMembers"
              placeholder="Select a team member"
              allowClear
              closeOnSelect
              transformItem={(item) => ({
                ...item,
                id: JSON.stringify({
                  id: item.id,
                  /**
                   * This is parsed on the server, because we need the name to create the note.
                   * @TODO This should be refactored to send the name as some metadata, instaed of like this
                   */
                  name: resolveTeamMemberName(item),
                }),
              })}
              renderItem={(item) => resolveTeamMemberName(item, true)}
            />
            {zo.errors.custodian()?.message ? (
              <p className="text-sm text-error-500">
                {zo.errors.custodian()?.message}
              </p>
            ) : null}
          </div>

          <div className={tw("mb-4 flex gap-3", isSelfService && "-mt-4")}>
            <Button
              type="submit"
              variant="primary"
              width="full"
              disabled={disabled || disableSubmit || idsTotalCount === 0}
            >
              Assign custody
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
  const maxAllowed = assignableUnits(asset);
  // Whole-row state badges are suppressed while a quantity row still has free
  // units. See `shouldShowStateBadges`.
  const showStateBadges = shouldShowStateBadges(asset, maxAllowed);
  // Use predefined presets to create label configurations
  const availabilityConfigs = [
    assetLabelPresets.inCustody(
      showStateBadges && asset.status === AssetStatus.IN_CUSTODY
    ),
    assetLabelPresets.checkedOut(
      showStateBadges && asset.status === AssetStatus.CHECKED_OUT
    ),
    assetLabelPresets.partOfKit(
      showStateBadges && asset.assetKits.length > 0,
      isQuantityTracked(asset)
    ),
  ];

  // Create the availability labels component with max 2 labels
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

      {/* Quantity-tracked rows hand over a number of units, not the whole
          item. Hidden once nothing is free: the row is still listed, and the
          blocker below explains why it cannot go. */}
      {qtyTracked && maxAllowed > 0 ? (
        <ScannedAssetQuantityInput
          assetId={asset.id}
          max={maxAllowed}
          unit={asset.unitOfMeasure || "units"}
        />
      ) : null}
    </div>
  );
}

export function KitRow({ kit }: { kit: KitFromQr }) {
  // Use predefined presets to create label configurations
  const availabilityConfigs = [
    kitLabelPresets.inCustody(kit.status === AssetStatus.IN_CUSTODY),
    kitLabelPresets.checkedOut(kit.status === AssetStatus.CHECKED_OUT),
    kitLabelPresets.hasAssetsInCustody(
      kit.assetKits.some((ak) => ak.asset.status === AssetStatus.IN_CUSTODY)
    ),
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
          <AlertDialogTitle>Assigning custody</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-4">
              <SubmissionState
                type={"asset"}
                status={custodyState.assetStatus}
                errorMessage={custodyState?.assetErrorMessage}
                custodianName={custodyState.custodianName}
              />
              <SubmissionState
                type={"kit"}
                status={custodyState.kitStatus}
                errorMessage={custodyState?.kitErrorMessage}
                custodianName={custodyState.custodianName}
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
  custodianName,
}: {
  type: "asset" | "kit";
  status: "processing" | "success" | "error" | "skipped";
  errorMessage?: string;
  custodianName?: string;
}) {
  // Return null for skipped status to hide the component entirely
  if (status === "skipped") {
    return null;
  }

  if (status === "processing") {
    return (
      <div className="flex flex-row gap-2">
        <Spinner />
        <TextLoader text={`Assigning custody to ${type}s`} />
      </div>
    );
  } else if (status === "success") {
    return (
      <div className="flex flex-row items-center gap-2 text-left">
        <span className="text-green-700">
          <CheckmarkIcon />
        </span>
        <div className="font-mono">
          {type === "asset" ? "Assets" : "Kits"} are now in custody of{" "}
          {custodianName}
        </div>
      </div>
    );
  } else if (status === "error") {
    return (
      <div>
        <div className="flex flex-row items-center gap-2 text-left">
          <CircleX className="size-[18px] text-error-500" />
          <div className="font-mono">Failed to assign custody to {type}s.</div>
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
