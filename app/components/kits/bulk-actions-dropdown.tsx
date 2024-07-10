import { useLoaderData, useNavigation } from "@remix-run/react";
import { useAtomValue } from "jotai";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import type { loader } from "~/routes/_layout+/kits._index";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { useControlledDropdownMenu } from "~/utils/use-controlled-dropdown-menu";
import BulkAssignCustodyDialog from "./bulk-assign-custody-dialog";
import BulkDeleteDialog from "./bulk-delete-dialog";
import BulkReleaseCustodyDialog from "./bulk-release-custody-dialog";
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
  const { items } = useLoaderData<typeof loader>();

  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  const navigation = useNavigation();
  const isLoading = isFormProcessing(navigation.state);

  const selectedKitIds = useAtomValue(selectedBulkItemsAtom);

  const selectedKits = items.filter((item) => selectedKitIds.includes(item.id));

  const allKitsInCustody = selectedKits.every(
    (kit) => kit.status === "IN_CUSTODY"
  );

  const allKitsAvailable = selectedKits.every(
    (kit) => kit.status === "AVAILABLE"
  );

  const someKitsCheckedOut = selectedKits.some(
    (kit) => kit.status === "CHECKED_OUT"
  );

  const someAssetsInsideKitsCheckedOutOrInCustody = selectedKits.some(
    (kit) =>
      kit.assets.some((asset) => asset.status === "CHECKED_OUT") ||
      kit.assets.some((asset) => asset.status === "IN_CUSTODY")
  );

  const disabled = selectedKitIds.length === 0;

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

      <BulkDeleteDialog />
      <BulkAssignCustodyDialog />
      <BulkReleaseCustodyDialog />

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
                  !allKitsInCustody
                    ? {
                        reason: "Some of the selected kits are not in custody",
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
                  !allKitsAvailable || someAssetsInsideKitsCheckedOutOrInCustody
                    ? {
                        reason: someAssetsInsideKitsCheckedOutOrInCustody
                          ? "Some of the asset(s) inside this kits are either checked out or in custody. You need to resolve that before you can assign custody."
                          : "Some of the selected kits are not available",
                      }
                    : isLoading
                }
              />
            </DropdownMenuItem>

            <DropdownMenuItem
              className="px-4 py-1 md:p-0"
              onSelect={(e) => {
                e.preventDefault();
              }}
            >
              <BulkUpdateDialogTrigger
                type="trash"
                label="Delete"
                onClick={closeMenu}
                disabled={
                  someKitsCheckedOut
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
                onClick={closeMenu}
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
