import { useNavigation } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { isFormProcessing } from "~/utils/form";
import { isSelectingAllItems } from "~/utils/list";
import { tw } from "~/utils/tw";
import BulkAssignCustodyDialog from "./bulk-assign-custody-dialog";
import BulkAssignTagsDialog from "./bulk-assign-tags-dialog";
import BulkCategoryUpdateDialog from "./bulk-category-update-dialog";
import BulkDeleteDialog from "./bulk-delete-dialog";
import BulkLocationUpdateDialog from "./bulk-location-update-dialog";
import BulkMarkAvailabilityDialog from "./bulk-mark-availability-dialog";
import BulkReleaseCustodyDialog from "./bulk-release-custody-dialog";
import BulkRemoveTagsDialog from "./bulk-remove-tags-dialog";
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
  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const disabled = selectedAssets.length === 0;

  const allSelected = isSelectingAllItems(selectedAssets);

  /**
   * Due to select all multi page selection,
   * some of the checks we do cannot be completed as we dont have the data loaded from the server.
   * As a solution for now we will handle the validation serverSide if hasSelectedAll is true
   */
  const allAssetsAreInCustody =
    allSelected ||
    selectedAssets.every((asset) => asset.status === "IN_CUSTODY");

  const allAssetsAreAvailable =
    allSelected ||
    selectedAssets.every((asset) => asset.status === "AVAILABLE");

  const someAssetCheckedOut = selectedAssets.some(
    (asset) => asset.status === "CHECKED_OUT"
  );

  const someAssetPartOfUnavailableKit = selectedAssets.some(
    (asset) => asset?.kit && asset.kit.status !== "AVAILABLE"
  );

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
      <BulkAssignTagsDialog />
      <BulkRemoveTagsDialog />
      <BulkCategoryUpdateDialog />
      <BulkAssignCustodyDialog />
      <BulkReleaseCustodyDialog />
      <BulkDeleteDialog />
      <BulkMarkAvailabilityDialog type="available" />
      <BulkMarkAvailabilityDialog type="unavailable" />

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
            <DropdownMenuItem className="py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                type="release-custody"
                label="Release custody"
                onClick={closeMenu}
                disabled={
                  !allAssetsAreInCustody || someAssetPartOfUnavailableKit
                    ? {
                        reason: someAssetPartOfUnavailableKit
                          ? "Some of the selected assets have custody assigned via a kit. If you want to change their custody, please update the kit instead."
                          : "Some of the selected assets are not in custody.",
                      }
                    : isLoading
                }
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="border-b py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                type="assign-custody"
                label="Assign custody"
                onClick={closeMenu}
                disabled={
                  !allAssetsAreAvailable || someAssetPartOfUnavailableKit
                    ? {
                        reason: someAssetPartOfUnavailableKit
                          ? "Some of the selected assets have custody assigned via a kit. If you want to change their custody, please update the kit instead."
                          : "Some of the selected assets are not available.",
                      }
                    : isLoading
                }
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                type="tag-add"
                onClick={closeMenu}
                disabled={isLoading}
                label="Assign tags"
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                type="tag-remove"
                onClick={closeMenu}
                disabled={isLoading}
                label="Remove tags"
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="border-t py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                type="location"
                onClick={closeMenu}
                disabled={isLoading}
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                type="category"
                onClick={closeMenu}
                disabled={isLoading}
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="border-t py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                label="Mark as available"
                type="available"
                onClick={closeMenu}
                disabled={isLoading}
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="border-b py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                label="Mark as unavailable"
                type="unavailable"
                onClick={closeMenu}
                disabled={isLoading}
              />
            </DropdownMenuItem>
            <DropdownMenuItem className="py-1 lg:p-0">
              <BulkUpdateDialogTrigger
                type="trash"
                label="Delete"
                onClick={closeMenu}
                disabled={
                  someAssetCheckedOut
                    ? {
                        reason:
                          "Some of the selected kits are checked out. Please finish your booking first, before deleting them.",
                      }
                    : isLoading
                }
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
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
