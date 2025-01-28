import { useState } from "react";
import { useLoaderData } from "@remix-run/react";
import { AlarmClockIcon } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { ChevronRight } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useUserData } from "~/hooks/use-user-data";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { loader } from "~/routes/_layout+/assets.$assetId";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { DeleteAsset } from "./delete-asset";
import RelinkQrCodeDialog from "./relink-qr-code-dialog";
import { UpdateGpsCoordinatesForm } from "./update-gps-coordinates-form";
import SetOrEditReminderDialog from "../asset-reminder/set-or-edit-reminder-dialog";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
import When from "../when/when";

const ConditionalActionsDropdown = () => {
  const { asset } = useLoaderData<typeof loader>();
  const [isRelinkQrDialogOpen, setIsRelinkQrDialogOpen] = useState(false);
  const [isSetReminderDialogOpen, setIsSetReminderDialogOpen] = useState(false);

  const assetCanBeReleased = asset.custody;
  const assetIsCheckedOut = asset.status === "CHECKED_OUT";

  const { roles, isSelfService, isAdministratorOrOwner } = useUserRoleHelper();
  const user = useUserData();

  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();

  const assetIsPartOfUnavailableKit = Boolean(
    asset.kit && asset.kit.status !== "AVAILABLE"
  );

  function handleMenuClose() {
    setOpen(false);
  }

  const disableReleaseForSelfService =
    isSelfService && asset.custody?.custodian?.userId !== user?.id;

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50  transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          if (defaultApplied && window.innerWidth <= 640) setOpen(open);
        }}
        open={open}
        defaultOpen={defaultOpen}
      >
        <DropdownMenuTrigger
          className="asset-actions hidden sm:flex"
          onClick={() => setOpen(!open)}
          asChild
        >
          <Button variant="secondary" data-test-id="assetActionsButton">
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* using custom dropdown menu triggerer on mobile which only opens dropdown not toggles menu to avoid conflicts with overlay*/}
        <Button
          variant="secondary"
          data-test-id="assetActionsButton"
          className="asset-actions sm:hidden"
          onClick={() => setOpen(true)}
        >
          <span className="flex items-center gap-2">
            Actions <ChevronRight className="chev" />
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
          asChild
          align="end"
          className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          ref={dropdownRef}
        >
          <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-[180px] md:rounded-t-[4px]">
            <When
              truthy={userHasPermission({
                roles,
                entity: PermissionEntity.asset,
                action: PermissionAction.custody,
              })}
            >
              <DropdownMenuItem
                className="border-b px-4 py-1 md:p-0"
                disabled={assetIsCheckedOut && !assetCanBeReleased}
              >
                {assetCanBeReleased ? (
                  <Button
                    to="overview/release-custody"
                    role="link"
                    variant="link"
                    className="justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700"
                    width="full"
                    onClick={handleMenuClose}
                    disabled={
                      assetIsPartOfUnavailableKit ||
                      disableReleaseForSelfService
                    }
                  >
                    <span className="flex items-center gap-1">
                      <Icon icon="release-custody" /> Release custody
                    </span>
                  </Button>
                ) : (
                  <Button
                    to="overview/assign-custody"
                    role="link"
                    variant="link"
                    className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                    width="full"
                    onClick={handleMenuClose}
                  >
                    <span className="flex items-center gap-2">
                      <Icon icon="assign-custody" />{" "}
                      {isSelfService ? "Take" : "Assign"} custody
                    </span>
                  </Button>
                )}
              </DropdownMenuItem>
            </When>

            <When
              truthy={userHasPermission({
                roles,
                entity: PermissionEntity.asset,
                action: PermissionAction.update,
              })}
            >
              <DropdownMenuItem
                className="px-4 py-1 md:p-0"
                disabled={assetIsCheckedOut}
              >
                <Button
                  to="overview/update-location"
                  role="link"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={handleMenuClose}
                >
                  <span className="flex items-center gap-2">
                    <Icon icon="location" /> Update location
                  </span>
                </Button>
              </DropdownMenuItem>

              <DropdownMenuItem className={tw("border-b px-4 py-1 md:p-0")}>
                <UpdateGpsCoordinatesForm
                  // Closes the dropdown when the button is clicked
                  callback={handleMenuClose}
                />
              </DropdownMenuItem>
              <DropdownMenuItem className="border-b px-4 py-1 md:p-0">
                <Button
                  role="button"
                  variant="link"
                  className="w-full justify-start px-4  py-3 text-gray-700 hover:text-gray-700"
                  onClick={() => {
                    handleMenuClose();
                    setIsRelinkQrDialogOpen(true);
                  }}
                >
                  <span className="flex items-center gap-2">
                    <Icon icon="barcode" />
                    Relink QR Code
                  </span>
                </Button>
              </DropdownMenuItem>
              <When truthy={isAdministratorOrOwner}>
                <DropdownMenuItem className="border-b px-4 py-1 md:p-0">
                  <Button
                    role="button"
                    variant="link"
                    className="w-full justify-start px-4  py-3 text-gray-700 hover:text-gray-700"
                    onClick={() => {
                      handleMenuClose();
                      setIsSetReminderDialogOpen(true);
                    }}
                  >
                    <span className="flex items-center gap-2">
                      <AlarmClockIcon className="size-5" />
                      Set reminder
                    </span>
                  </Button>
                </DropdownMenuItem>
              </When>
              <DropdownMenuItem className="px-4 py-1 md:p-0">
                <Button
                  to="edit"
                  role="link"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
                  width="full"
                >
                  <span className="flex items-center gap-2">
                    <Icon icon="pen" /> Edit
                  </span>
                </Button>
              </DropdownMenuItem>
              <DropdownMenuItem className="px-4 py-1 md:p-0">
                <Button
                  to="overview/duplicate"
                  role="link"
                  variant="link"
                  className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={handleMenuClose}
                >
                  <span className="flex items-center gap-2">
                    <Icon icon="duplicate" /> Duplicate
                  </span>
                </Button>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="px-4 py-1 md:p-0"
                onSelect={(e) => {
                  e.preventDefault();
                }}
                disabled={assetIsCheckedOut || assetIsPartOfUnavailableKit}
              >
                <DeleteAsset
                  asset={asset}
                  trigger={
                    <Button
                      variant="link"
                      data-test-id="deleteAssetButton"
                      icon="trash"
                      className="justify-start rounded-sm px-4 py-3 text-sm font-semibold text-gray-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
                    >
                      Delete
                    </Button>
                  }
                />
              </DropdownMenuItem>
              <DropdownMenuItem className="border-t p-4 md:hidden md:p-0">
                <Button
                  role="button"
                  variant="secondary"
                  className="flex items-center justify-center text-gray-700 hover:text-gray-700 "
                  width="full"
                  onClick={handleMenuClose}
                >
                  Close
                </Button>
              </DropdownMenuItem>
              {assetIsCheckedOut ? (
                <div className=" border-t p-2 text-left text-xs">
                  Some actions are disabled due to the asset being checked out.
                </div>
              ) : null}
              {assetIsPartOfUnavailableKit ? (
                <div className=" border-t p-2 text-left text-xs">
                  Some actions are disabled due to the asset being part of a
                  kit.
                </div>
              ) : null}
            </When>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <When truthy={isRelinkQrDialogOpen}>
        <RelinkQrCodeDialog
          open={isRelinkQrDialogOpen}
          onClose={() => {
            setIsRelinkQrDialogOpen(false);
          }}
        />
      </When>
      <When truthy={isSetReminderDialogOpen && isAdministratorOrOwner}>
        <SetOrEditReminderDialog
          open={isSetReminderDialogOpen}
          onClose={() => {
            setIsSetReminderDialogOpen(false);
          }}
        />
      </When>
    </>
  );
};

const ActionsDropdown = () => {
  const isHydrated = useHydrated();

  if (!isHydrated)
    return (
      <Button variant="secondary" to="#" data-test-id="assetActionsButton">
        <span className="flex items-center gap-2">
          Actions <ChevronRight className="chev rotate-90" />
        </span>
      </Button>
    );

  return (
    <div className="actions-dropdown flex">
      <ConditionalActionsDropdown />
    </div>
  );
};

export default ActionsDropdown;
