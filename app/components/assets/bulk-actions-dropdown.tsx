import type { Prisma } from "@prisma/client";
import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { useControlledDropdownMenu } from "~/utils/use-controlled-dropdown-menu";
import BulkCategoryUpdateDialog from "./bulk-category-update-dialog";
import BulkCheckInDialog from "./bulk-checkin-dialog";
import BulkCheckoutDialog from "./bulk-checkout-dialog";
import BulkDeleteDialog from "./bulk-delete-dialog";
import BulkLocationUpdateDialog from "./bulk-location-update-dialog";
import { BulkUpdateDialogTrigger } from "../bulk-update-dialog/bulk-update-dialog";
import { ChevronRight } from "../icons/library";
import { Button } from "../shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../shared/dropdown";

export default function BulkActionsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <Button variant="secondary" to="#">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );
  }

  return (
    <div className="actions-dropdown flex">
      <ConditionalDropdown />
    </div>
  );
}

function ConditionalDropdown() {
  const { items } = useLoaderData<{
    items: Prisma.AssetGetPayload<{ include: { kit: true; custody: true } }>[];
  }>();

  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  const selectedAssetIds = useAtomValue(selectedBulkItemsAtom);

  const selectedAssets = items.filter((item) =>
    selectedAssetIds.includes(item.id)
  );

  const disabled = selectedAssetIds.length === 0;

  const someAssetCheckedOut = selectedAssets.some(
    (asset) => asset.status === "CHECKED_OUT"
  );

  const someAssetPartOfUnavailableKit = selectedAssets.some(
    (asset) => asset?.kit && asset.kit.status !== "AVAILABLE"
  );

  /** Asset can be release only if all selected items has custody */
  const assetsCanBeReleased = selectedAssets.every((asset) => !!asset?.custody);

  const someAssetsAvailable = selectedAssets.some(
    (asset) => asset.status === "AVAILABLE"
  );
  const someAssetsInCustody = selectedAssets.some(
    (asset) => asset.status === "IN_CUSTODY"
  );

  /**
   * Check-in and check-out are disabled for the following reasons
   * 1. User has selected AVAILABLE and IN_CUSTODY assets at same time
   * 2. Some assets are CHECKED_OUT and cannot be released
   */
  const isCheckInCheckOutDisabled = [
    someAssetsAvailable && someAssetsInCustody,
    someAssetCheckedOut && !assetsCanBeReleased,
  ].some(Boolean);

  function closeMenu() {
    setOpen(false);
  }

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50  transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}
      <BulkLocationUpdateDialog />
      <BulkCategoryUpdateDialog />
      <BulkCheckoutDialog />
      <BulkCheckInDialog />
      <BulkDeleteDialog />

      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (defaultApplied && window.innerWidth <= 640) setOpen(open);
        }}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className="actions-dropdown hidden sm:flex"
          onClick={() => setOpen(!open)}
          asChild
          disabled={disabled}
        >
          <Button type="button" variant="secondary">
            <span className="flex items-center gap-2">Actions</span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu trigger on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          className="asset-actions sm:hidden"
          onClick={() => setOpen(true)}
          disabled={disabled}
          type="button"
        >
          <span className="flex items-center gap-2">Actions</span>
        </Button>

        {open && (
          <style
            dangerouslySetInnerHTML={{
              __html: `@media (max-width: 640px) {
                [data-radix-popper-content-wrapper] {
                  transform: none !important;
                  will-change: auto !important;
                }
              }`,
            }} // is a hack to fix the dropdown menu not being in the right place on mobile
            // can not target [data-radix-popper-content-wrapper] for this file only with css
            // so we have to use dangerouslySetInnerHTML
            // PR : https://github.com/Shelf-nu/shelf.nu/pull/304
          ></style>
        )}

        <DropdownMenuContent
          asChild
          align="end"
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            <DropdownMenuItem
              className="border-b py-1 lg:p-0"
              disabled={isCheckInCheckOutDisabled || isLoading}
            >
              {assetsCanBeReleased ? (
                <BulkUpdateDialogTrigger
                  type="check-in"
                  label="Check in"
                  onClick={closeMenu}
                  disabled={someAssetPartOfUnavailableKit}
                />
              ) : (
                <BulkUpdateDialogTrigger
                  type="check-out"
                  label="Check out"
                  onClick={closeMenu}
                />
              )}
            </DropdownMenuItem>

            <DropdownMenuItem
              className="py-1 lg:p-0"
              disabled={someAssetCheckedOut || isLoading}
            >
              <BulkUpdateDialogTrigger type="location" onClick={closeMenu} />
            </DropdownMenuItem>

            <DropdownMenuItem
              className="border-b py-1 lg:p-0"
              disabled={isLoading}
            >
              <BulkUpdateDialogTrigger type="category" onClick={closeMenu} />
            </DropdownMenuItem>

            <DropdownMenuItem className="py-1 lg:p-0" disabled={isLoading}>
              <BulkUpdateDialogTrigger
                type="trash"
                label="Delete"
                onClick={closeMenu}
              />
            </DropdownMenuItem>

            <DropdownMenuItem className="border-t md:hidden lg:p-0">
              <Button
                role="button"
                variant="secondary"
                className="flex items-center justify-center text-gray-700 hover:text-gray-700 "
                width="full"
                onClick={() => setOpen(false)}
              >
                Close
              </Button>
            </DropdownMenuItem>
            {someAssetCheckedOut ? (
              <div className=" border-t p-2 text-left text-xs">
                Some actions are disabled due to the assets being checked out.
              </div>
            ) : null}
            {someAssetPartOfUnavailableKit ? (
              <div className=" border-t p-2 text-left text-xs">
                Some actions are disabled due to the assets being part of a kit.
              </div>
            ) : null}
            {isCheckInCheckOutDisabled ? (
              <div className=" border-t p-2 text-left text-xs">
                Some actions are disabled due to the selection of available and
                unavailable assets at same time.
              </div>
            ) : null}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
