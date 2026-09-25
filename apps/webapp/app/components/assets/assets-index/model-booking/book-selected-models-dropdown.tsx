/**
 * Book Selected Models Dropdown
 *
 * The toolbar control of the asset index's model view: it turns a selection of
 * models into either a new booking or an addition to one that already exists.
 * Passing it as the model-view `List`'s `bulkActions` is also what makes that
 * list render a checkbox column at all.
 *
 * Nothing concrete is booked from here. Each selected model becomes a
 * `BookingModelRequest` — a promise of N units, fulfilled later by scanning or
 * assigning actual assets — so the two entries open quantity dialogs rather
 * than asset pickers.
 *
 * Each entry's gate matches the endpoint behind it: creating a booking needs
 * `booking: create`, adding reservations to an existing one needs
 * `booking: update`. A control the server will refuse is worse than no control.
 *
 * @see {@link file://./create-booking-for-models-dialog.tsx}
 * @see {@link file://./add-models-to-existing-booking-dialog.tsx}
 * @see {@link file://./../book-selected-assets-dropdown.tsx} — the asset-row equivalent
 */
import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { ChevronRightIcon } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogTrigger } from "~/components/bulk-update-dialog/bulk-update-dialog";
import { Button } from "~/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { MobileDropdownStyles } from "~/components/shared/mobile-dropdown-styles";
import When from "~/components/when/when";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import AddModelsToExistingBookingDialog from "./add-models-to-existing-booking-dialog";
import CreateBookingForModelsDialog from "./create-booking-for-models-dialog";

/**
 * The "Book selection" control for the model view.
 *
 * @returns A placeholder button before hydration, the live dropdown after
 */
export default function BookSelectedModelsDropdown() {
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return (
      <Button type="button" variant="secondary">
        <span className="flex items-center gap-2">
          Book <ChevronRightIcon className="chev size-4" />
        </span>
      </Button>
    );
  }

  return <ConditionalActionsDropdown />;
}

/**
 * The hydrated dropdown, with the dialogs it opens.
 *
 * @returns The trigger, the menu, and both booking dialogs
 */
function ConditionalActionsDropdown() {
  const {
    ref: dropdownRef,
    defaultApplied,
    open,
    defaultOpen,
    setOpen,
  } = useControlledDropdownMenu();
  const organization = useCurrentOrganization();
  const selectedModels = useAtomValue(selectedBulkItemsAtom);
  const { roles } = useUserRoleHelper();

  const buttonTitle = `Book selection ${
    !selectedModels.length ? "" : `(${selectedModels.length})`
  }`;

  const disabledReason = useMemo(() => {
    if (!selectedModels.length) {
      return { reason: "You must select at least 1 model to book." };
    }

    return false;
  }, [selectedModels]);

  function closeMenu() {
    setOpen(false);
  }

  // Personal workspaces have no bookings, so there is nothing for either entry
  // to open.
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
        <CreateBookingForModelsDialog />
      </When>
      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.booking,
          action: PermissionAction.update,
        })}
      >
        <AddModelsToExistingBookingDialog />
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
          <Button type="button" disabled={disabledReason}>
            <span className="flex items-center gap-2">
              {buttonTitle} <ChevronRightIcon className="chev size-4" />
            </span>
          </Button>
        </DropdownMenuTrigger>

        {/* The mobile trigger only OPENS the menu — toggling it here fights the
            overlay above, which closes on its own click. */}
        <Button
          type="button"
          className="flex-1 sm:hidden"
          onClick={() => setOpen(true)}
          disabled={disabledReason}
        >
          <span className="flex items-center gap-2">
            {buttonTitle} <ChevronRightIcon className="chev size-4" />
          </span>
        </Button>

        <MobileDropdownStyles open={open} />

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
                  type="model-bookings"
                  label="Create new booking"
                  onClick={closeMenu}
                  disabled={disabledReason}
                />
              </DropdownMenuItem>
            </When>
            <When
              truthy={userHasPermission({
                roles,
                entity: PermissionEntity.booking,
                action: PermissionAction.update,
              })}
            >
              <DropdownMenuItem className="py-1 lg:p-0">
                <BulkUpdateDialogTrigger
                  type="model-booking-exist"
                  label="Add to existing"
                  onClick={closeMenu}
                  disabled={disabledReason}
                />
              </DropdownMenuItem>
            </When>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
