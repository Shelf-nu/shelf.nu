import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useLoaderData } from "@remix-run/react";
import { AlarmClockIcon } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { ChevronRight } from "~/components/icons/library";
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

  const { ref: popoverContentRef, open, setOpen } = useControlledDropdownMenu();
  const assetIsPartOfKit = Boolean(asset.kit);
  const assetIsPartOfUnavailableKit = Boolean(
    asset.kit && asset.kit.status !== "AVAILABLE"
  );
  const custodyActionDisabled = assetIsCheckedOut && !assetCanBeReleased;

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
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="secondary"
            data-test-id="assetActionsButton"
            className="asset-actions hidden sm:flex"
          >
            <span className="flex items-center gap-2">
              Actions <ChevronRight className="chev" />
            </span>
          </Button>
        </PopoverTrigger>

        {/* using custom trigger on mobile which only opens popover to avoid conflicts with overlay */}
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
            }} // is a hack to fix the popover not being in the right place on mobile
            // can not target [data-radix-popper-content-wrapper] for this file only with css
            // so we have to use dangerouslySetInnerHTML
            // PR : https://github.com/Shelf-nu/shelf.nu/pull/304
          ></style>
        )}
        <PopoverPortal>
          <PopoverContent
            ref={popoverContentRef}
            tabIndex={-1}
            align="end"
            side="bottom"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              popoverContentRef.current?.focus();
            }}
            className="order actions-dropdown static w-screen rounded-b-none rounded-t-[4px] border border-gray-300 bg-white p-0 text-right md:static md:w-[230px] md:rounded-t-[4px]"
          >
            <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-full md:rounded-t-[4px]">
              <When
                truthy={userHasPermission({
                  roles,
                  entity: PermissionEntity.asset,
                  action: PermissionAction.custody,
                })}
              >
                <div
                  className="border-b px-0 py-1 md:p-0"
                  aria-disabled={custodyActionDisabled}
                >
                  {assetCanBeReleased ? (
                    <Button
                      to="overview/release-custody"
                      role="link"
                      variant="link"
                      className="justify-start whitespace-nowrap px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
                      onClick={handleMenuClose}
                      disabled={
                        custodyActionDisabled ||
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
                      className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
                      onClick={handleMenuClose}
                      disabled={custodyActionDisabled}
                    >
                      <span className="flex items-center gap-2">
                        <Icon icon="assign-custody" />{" "}
                        {isSelfService ? "Take" : "Assign"} custody
                      </span>
                    </Button>
                  )}
                </div>
              </When>

              <When
                truthy={userHasPermission({
                  roles,
                  entity: PermissionEntity.asset,
                  action: PermissionAction.update,
                })}
              >
                <div
                  className="px-0 py-1 md:p-0"
                  aria-disabled={assetIsCheckedOut}
                >
                  <Button
                    to="overview/update-location"
                    role="link"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={handleMenuClose}
                    disabled={
                      assetIsCheckedOut
                        ? true
                        : assetIsPartOfKit
                        ? {
                            reason: (
                              <>
                                This asset's location is managed by its parent
                                kit <strong>"{asset.kit?.name}"</strong>. Update
                                the kit's location instead.
                              </>
                            ),
                          }
                        : undefined
                    } // to show tooltip only when disabled
                  >
                    <span className="flex items-center gap-2">
                      <Icon icon="location" /> Update location
                    </span>
                  </Button>
                </div>

                <div className={tw("border-b px-0 py-1 md:p-0")}>
                  <UpdateGpsCoordinatesForm
                    // Closes the dropdown when the button is clicked
                    callback={handleMenuClose}
                  />
                </div>
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    role="button"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
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
                </div>
                <When truthy={isAdministratorOrOwner}>
                  <div className="border-b px-0 py-1 md:p-0">
                    <Button
                      role="button"
                      variant="link"
                      className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
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
                  </div>
                </When>
                <div className="px-0 py-1 md:p-0">
                  <Button
                    to="edit"
                    role="link"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                  >
                    <span className="flex items-center gap-2">
                      <Icon icon="pen" /> Edit
                    </span>
                  </Button>
                </div>
                <div className="px-0 py-1 md:p-0">
                  <Button
                    to="overview/duplicate"
                    role="link"
                    variant="link"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={handleMenuClose}
                  >
                    <span className="flex items-center gap-2">
                      <Icon icon="duplicate" /> Duplicate
                    </span>
                  </Button>
                </div>
                <div
                  className="px-0 py-1 md:p-0"
                  aria-disabled={
                    assetIsCheckedOut || assetIsPartOfUnavailableKit
                  }
                >
                  <DeleteAsset
                    asset={asset}
                    trigger={
                      <Button
                        variant="link"
                        data-test-id="deleteAssetButton"
                        icon="trash"
                        className="justify-start rounded-sm px-4 py-3 text-sm font-semibold text-gray-700 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 hover:bg-slate-100 hover:text-gray-700"
                        width="full"
                        disabled={
                          assetIsCheckedOut || assetIsPartOfUnavailableKit
                        }
                      >
                        Delete
                      </Button>
                    }
                  />
                </div>
                <div className="border-t p-4 md:hidden md:p-0">
                  <Button
                    role="button"
                    variant="secondary"
                    className="flex items-center justify-center text-gray-700 hover:text-gray-700 "
                    width="full"
                    onClick={handleMenuClose}
                  >
                    Close
                  </Button>
                </div>
                {assetIsCheckedOut ? (
                  <div className=" border-t p-2 text-left text-xs">
                    Some actions are disabled due to the asset being checked
                    out.
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
          </PopoverContent>
        </PopoverPortal>
      </Popover>

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
          action={`/assets/${asset.id}`}
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
