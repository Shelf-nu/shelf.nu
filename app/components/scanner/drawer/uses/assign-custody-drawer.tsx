import { useMemo, useState } from "react";
import { AssetStatus } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { useAtomValue, useSetAtom } from "jotai";
import { useZorm } from "react-zorm";
import { z } from "zod";
import {
  clearScannedItemsAtom,
  removeScannedItemAtom,
  scannedItemsAtom,
  removeScannedItemsByAssetIdAtom,
  removeMultipleScannedItemsAtom,
} from "~/atoms/qr-scanner";
import { Form } from "~/components/custom-form";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { AssetLabel } from "~/components/icons/library";
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
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { createCustodianSchema } from "~/modules/custody/schema";
import type { AssetWithBooking } from "~/routes/_layout+/bookings.$bookingId.add-assets";
import type { KitForBooking } from "~/routes/_layout+/bookings.$bookingId.add-kits";
import type { ScannerLoader } from "~/routes/_layout+/scanner";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import {
  assetLabelPresets,
  createAvailabilityLabels,
  kitLabelPresets,
} from "../availability-label-factory";
import { createBlockers } from "../blockers-factory";
import ConfigurableDrawer from "../configurable-drawer";
import { GenericItemRow, DefaultLoadingState } from "../generic-item-row";

// Export the schema so it can be reused
export const AssignCustodyToSignedItemsSchema = z.object({
  assetIds: z.array(z.string()).min(1),
});

const BulkAssignCustodySchema = z
  .object({
    assetIds: z.array(z.string()).optional().default([]),
    kitsIds: z.array(z.string()).optional().default([]),
    custodian: createCustodianSchema(),
  })
  .refine((data) => data.assetIds.length > 0 || data.kitsIds.length > 0, {
    message: "At least one asset or kit must be selected",
    path: ["assetIds"], // This will attach the error to the assetIds field
  });

/**
 * Drawer component for managing scanned assets to be added to bookings
 */
export default function AssignCustodyDrawer({
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
    .map((item) => item?.data as AssetWithBooking);

  const kits = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data as KitForBooking);

  // List of asset IDs for the form
  const assetIds = Array.from(
    new Set([
      ...assets.map((a) => a.id),
      ...kits.flatMap((k) => k.assets.map((a) => a.id)),
    ])
  );

  // Setup blockers
  const errors = Object.entries(items).filter(([, item]) => !!item?.error);

  // Asset blockers
  const assetsAlreadyInCustody = assets
    .filter((asset) => !!asset && asset.status === AssetStatus.IN_CUSTODY)
    .map((asset) => asset.id);

  // Asset is checked out
  const assetsAreCheckedOut = assets
    .filter((asset) => !!asset && asset.status === AssetStatus.CHECKED_OUT)
    .map((asset) => asset.id);

  // Asset is part of a kit
  const assetsArePartOfKit = assets
    .filter((asset) => !!asset && asset.kitId && asset.id)
    .map((asset) => asset.id);

  // Kit blockers
  // Kit is in custody
  const kitsIsAlreadyInCustody = kits
    .filter((kit) => kit.status === AssetStatus.IN_CUSTODY)
    .map((kit) => kit.id);

  // Kit has assets inside that that are in custody
  const kitsWithAssetsInCustody = kits
    .filter((kit) =>
      kit.assets.some((asset) => asset.status === AssetStatus.IN_CUSTODY)
    )
    .map((kit) => kit.id);
  // Kit is checked out
  const kitsAreCheckedOut = kits
    .filter((kit) => kit.status === AssetStatus.CHECKED_OUT)
    .map((kit) => kit.id);

  // Find the QR IDs that correspond to kit IDs with blockers
  // This is necessary because we need to remove the QR IDs from the items object, not the kit IDs
  const getQrIdsForKitIds = (kitIds: string[]) =>
    Object.entries(items)
      .filter(([, item]) => {
        if (!item || item.type !== "kit") return false;
        return kitIds.includes((item.data as KitForBooking)?.id);
      })
      .map(([qrId]) => qrId);

  // Get the QR IDs for each type of kit blocker
  const qrIdsOfKitsInCustody = getQrIdsForKitIds(kitsIsAlreadyInCustody);
  const qrIdsOfKitsWithAssetsInCustody = getQrIdsForKitIds(
    kitsWithAssetsInCustody
  );
  const qrIdsOfKitsCheckedOut = getQrIdsForKitIds(kitsAreCheckedOut);

  // Create blockers configuration
  const blockerConfigs = [
    {
      condition: assetsAlreadyInCustody.length > 0,
      count: assetsAlreadyInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          already <strong>in custody</strong>.
        </>
      ),
      onResolve: () => removeAssetsFromList(assetsAlreadyInCustody),
    },
    {
      condition: assetsAreCheckedOut.length > 0,
      count: assetsAreCheckedOut.length,
      message: (count: number) => (
        <>
          <strong>{`${count} asset${count > 1 ? "s are" : " is"}`}</strong>{" "}
          checked out.
        </>
      ),
      description: "Note: Checked out assets cannot be assigned custody.",
      onResolve: () => removeAssetsFromList(assetsAreCheckedOut),
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
      description: "Note: Scan Kit QR to add the full kit",
      onResolve: () => removeAssetsFromList(assetsArePartOfKit),
    },
    {
      condition: qrIdsOfKitsInCustody.length > 0,
      count: qrIdsOfKitsInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong>{" "}
          already <strong>in custody</strong>.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsInCustody),
    },
    {
      condition: qrIdsOfKitsWithAssetsInCustody.length > 0,
      count: qrIdsOfKitsWithAssetsInCustody.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong>{" "}
          already have assets <strong>in custody</strong>.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsWithAssetsInCustody),
    },
    {
      condition: qrIdsOfKitsCheckedOut.length > 0,
      count: qrIdsOfKitsCheckedOut.length,
      message: (count: number) => (
        <>
          <strong>{`${count} kit${count > 1 ? "s are" : " is"} `}</strong>{" "}
          checked out.
        </>
      ),
      onResolve: () => removeItemsFromList(qrIdsOfKitsCheckedOut),
      description: "Note: Checked out kits cannot be assigned custody.",
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
        ...assetsAlreadyInCustody,
        ...assetsAreCheckedOut,
        ...assetsArePartOfKit,
      ]);
      removeItemsFromList([
        ...errors.map(([qrId]) => qrId),
        ...qrIdsOfKitsInCustody,
        ...qrIdsOfKitsWithAssetsInCustody,
        ...qrIdsOfKitsCheckedOut,
      ]);
    },
  });

  // Custom empty state content
  const emptyStateContent = (expanded: boolean) => (
    <>
      {expanded && (
        <div className="mb-4 rounded-full bg-primary-50 p-2">
          <div className="rounded-full bg-primary-100 p-2 text-primary">
            <AssetLabel className="size-6" />
          </div>
        </div>
      )}
      <div>
        {expanded && (
          <div className="text-base font-semibold text-gray-900">
            List is empty
          </div>
        )}
        <p className="text-sm text-gray-600">Fill list by scanning codes...</p>
      </div>
    </>
  );

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
          return <AssetRow asset={data as AssetWithBooking} />;
        } else if (item?.type === "kit") {
          return <KitRow kit={data as KitForBooking} />;
        }
        return null;
      }}
    />
  );

  return (
    <ConfigurableDrawer
      schema={AssignCustodyToSignedItemsSchema}
      formData={{ assetIds }}
      items={items}
      onClearItems={clearList}
      title="Items scanned"
      emptyStateContent={emptyStateContent}
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

function CustodyForm({ disableSubmit }: { disableSubmit: boolean }) {
  const fetcher = useFetcherWithReset<any>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [custodyState, setCustodyState] = useState<{
    assetMessage: string;
    kitMessage: string;
    custodianName: string;
  }>({
    assetMessage: "Assigning custody to assets...",
    kitMessage: "Assigning custody to kits...",
    custodianName: "",
  });

  // @ts-ignore -- @TODO: Fix this
  const disabled = isFormProcessing(fetcher);
  const { isSelfService } = useUserRoleHelper();
  const { teamMembers } = useLoaderData<ScannerLoader>();
  const zo = useZorm("BulkAssignCustody", BulkAssignCustodySchema, {
    onValidSubmit: (e) => {
      e.preventDefault();
      setDialogOpen(true);

      const { custodian, assetIds, kitsIds } = e.data;
      setCustodyState((state) => ({
        ...state,
        custodianName: custodian.name,
      }));

      const assetFormData = {
        custodian,
        assetIds,
      };
      const kitFormData = {
        custodian,
        kitsIds,
        intent: "bulk-assign-custody",
      };

      const assetPromise = fetch("/api/assets/bulk-assign-custody", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(assetFormData),
      });

      const kitPromise = fetch("/api/kits/bulk-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(kitFormData),
      });

      // show UI updates
      setCustodyState((state) => ({
        ...state,
        assetMessage: "Assigning custody to assets...",
        kitMessage: "Assigning custody to kits...",
      }));

      assetPromise
        .then((response) => response.json())
        .then((data) => {
          setCustodyState((state) => ({
            ...state,
            assetMessage: "Custody assigned to assets successfully!",
          }));
        })
        .catch((error) => {
          setCustodyState((state) => ({
            ...state,
            assetMessage: "Error assigning custody to assets",
          }));
        });

      kitPromise
        .then((response) => response.json())
        .then((data) => {
          setCustodyState((state) => ({
            ...state,
            kitMessage: "Custody assigned to kits successfully!",
          }));
        })
        .catch((error) => {
          setCustodyState((state) => ({
            ...state,
            kitMessage: "Error assigning custody to kits",
          }));
        });
    },
  });

  const fetcherError = useMemo(() => fetcher?.data?.error?.message, [fetcher]);
  const items = useAtomValue(scannedItemsAtom);

  const assetIds = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "asset")
    .map((item) => item?.data?.id);

  const kitsIds = Object.values(items)
    .filter((item) => !!item && item.data && item.type === "kit")
    .map((item) => item?.data?.id);

  return (
    <>
      <SubmittingDialog
        open={dialogOpen}
        setOpen={setDialogOpen}
        custodyState={custodyState}
      />
      <fetcher.Form ref={zo.ref}>
        {assetIds.map((id, index) => (
          <input
            key={`asset-${id}`}
            type="hidden"
            name={`assetIds[${index}]`}
            value={id}
          />
        ))}

        {kitsIds.map((id, index) => (
          <input
            key={`kit-${id}`}
            type="hidden"
            name={`kitsIds[${index}]`}
            value={id}
          />
        ))}

        <div className="pr-4">
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
            {fetcherError ? (
              <p className="text-sm text-error-500">{fetcherError}</p>
            ) : null}
          </div>

          <div className={tw("mb-4 flex gap-3", isSelfService && "-mt-8")}>
            <Button
              variant="secondary"
              width="full"
              disabled={disabled}
              // onClick={handleCloseDialog}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              width="full"
              disabled={
                disabled || disableSubmit || Object.values(items).length === 0
              }
            >
              Assign custody
            </Button>
          </div>
        </div>
      </fetcher.Form>
    </>
  );
}

function SubmittingDialog({
  open,
  setOpen,
  custodyState,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  custodyState: { assetMessage: string; kitMessage: string };
}) {
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          {/* <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <Icon icon="trash" />
            </span>
          </div> */}
          <AlertDialogTitle>Assigning custody</AlertDialogTitle>
          <AlertDialogDescription>
            <p>{custodyState.assetMessage}</p>
            <p>{custodyState.kitMessage}</p>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialogCancel>

            <Button to="/assets" variant={"primary"}>
              View assets
            </Button>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Implement item renderers if they're not already defined elsewhere
export function AssetRow({ asset }: { asset: AssetWithBooking }) {
  // Use predefined presets to create label configurations
  const availabilityConfigs = [
    assetLabelPresets.inCustody(asset.status === AssetStatus.IN_CUSTODY),
    assetLabelPresets.checkedOut(asset.status === AssetStatus.CHECKED_OUT),
    assetLabelPresets.partOfKit(!!asset.kitId),
  ];

  // Create the availability labels component with max 2 labels
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

export function KitRow({ kit }: { kit: KitForBooking }) {
  // Use predefined presets to create label configurations
  const availabilityConfigs = [
    kitLabelPresets.inCustody(kit.status === AssetStatus.IN_CUSTODY),
    kitLabelPresets.checkedOut(kit.status === AssetStatus.CHECKED_OUT),
    kitLabelPresets.hasAssetsInCustody(
      kit.assets.some((asset) => asset.status === AssetStatus.IN_CUSTODY)
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
      </div>
    </div>
  );
}
