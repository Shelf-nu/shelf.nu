import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { ChevronRightIcon } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogTrigger } from "~/components/bulk-update-dialog/bulk-update-dialog";
import Icon from "~/components/icons/icon";
import { Button } from "~/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import When from "~/components/when/when";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useCurrentOrganization } from "~/hooks/use-current-organization-id";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isSelectingAllItems } from "~/utils/list";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import CreateBookingForSelectedAssetsDialog from "./create-booking-for-selected-assets-dialog";

export default function BookSelectedAssetsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    <Button variant="secondary">
      <span className="flex items-center gap-2">
        Book <ChevronRightIcon className="chev size-4" />
      </span>
    </Button>;
  }

  return <ConditionalActionsDropdown />;
}

function ConditionalActionsDropdown() {
  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();
  const organization = useCurrentOrganization();
  const selectedAssets = useAtomValue(selectedBulkItemsAtom);
  const { roles } = useUserRoleHelper();

  const allSelected = isSelectingAllItems(selectedAssets);
  const buttonTitle = `Book selection ${
    !selectedAssets.length
      ? ""
      : allSelected
      ? "(All)"
      : `(${selectedAssets.length})`
  }`;

  const disabledReason = useMemo(() => {
    /** If any asset is part of a kit. */
    const someAssetsPartOfKit = selectedAssets.some((asset) => !!asset.kit);
    if (someAssetsPartOfKit) {
      return {
        reason:
          "Cannot book assets directly because some of the assets are part of a kit.",
      };
    }

    /** If any asset is marked as unavailable. */
    const someAssetsMarkedUnavailable = selectedAssets.some(
      (asset) => !asset.availableToBook
    );
    if (someAssetsMarkedUnavailable) {
      return { reason: "Some of the assets are marked as unavailable." };
    }

    /** If user has not selected any asset. */
    if (!selectedAssets.length) {
      return { reason: "You must select at least 1 asset to book." };
    }

    return false;
  }, [selectedAssets]);

  function closeMenu() {
    setOpen(false);
  }

  if (isPersonalOrg(organization)) {
    return null;
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

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.booking,
          action: PermissionAction.create,
        })}
      >
        <CreateBookingForSelectedAssetsDialog />
      </When>

      <DropdownMenu
        modal={false}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={(openValue) => {
          if (defaultApplied && window.innerWidth <= 640) {
            setOpen(openValue);
          }
        }}
      >
        <DropdownMenuTrigger
          className="hidden sm:flex"
          onClick={() => {
            setOpen(!open);
          }}
          asChild
        >
          <Button disabled={disabledReason}>
            <span className="flex items-center gap-2">
              {buttonTitle} <ChevronRightIcon className="chev size-4" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu triggerer on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          className="sm:hidden"
          onClick={() => setOpen(true)}
          disabled={disabledReason}
        >
          <span className="flex items-center gap-2">
            {buttonTitle} <ChevronRightIcon className="chev size-4" />
          </span>
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
          ref={dropdownRef}
          asChild
          className="order actions-dropdown w-screen rounded-b-none rounded-t bg-white p-0 text-right md:static md:w-56"
        >
          <div className="fixed bottom-0 left-0">
            <When
              truthy={userHasPermission({
                roles,
                entity: PermissionEntity.booking,
                action: PermissionAction.create,
              })}
            >
              <DropdownMenuItem className="py-1 lg:p-0">
                <BulkUpdateDialogTrigger
                  type="bookings"
                  label="Create new booking"
                  onClick={closeMenu}
                  disabled={disabledReason}
                />
              </DropdownMenuItem>
            </When>
            <Button
              disabled={disabledReason}
              to="overview/release-custody"
              role="link"
              variant="link"
              className="justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700"
              width="full"
            >
              <span className="flex items-center gap-2">
                <Icon icon="booking-exist" /> Add to existing booking
              </span>
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
