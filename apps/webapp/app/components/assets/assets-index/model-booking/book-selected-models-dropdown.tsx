/**
 * Book Selected Models Dropdown
 *
 * The toolbar control of the asset index's model view: it turns a selection of
 * models into either a new booking or an addition to one that already exists.
 * Passing it as the model-view `List`'s `bulkActions` is also what makes that
 * list render a checkbox column at all.
 *
 * Nothing concrete is booked from here. Each selected model becomes a
 * `BookingModelRequest`, a promise of N units fulfilled later by scanning or
 * assigning actual assets, so the two entries open quantity dialogs rather
 * than asset pickers.
 *
 * Each entry's gate matches the endpoint behind it: creating a booking needs
 * `booking: create`, adding reservations to an existing one needs
 * `booking: update`. A control the server will refuse is worse than no control.
 *
 * Built on Radix `Popover`, the primitive this codebase uses for menu-like
 * controls. The two entries are ordinary buttons, so Tab reaches them and
 * Enter activates them; Escape closes the panel and returns focus to the
 * trigger.
 *
 * @see {@link file://./create-booking-for-models-dialog.tsx}
 * @see {@link file://./add-models-to-existing-booking-dialog.tsx}
 * @see {@link file://./../book-selected-assets-dropdown.tsx} for the asset-row equivalent
 */
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useAtomValue } from "jotai";
import { ChevronRightIcon } from "lucide-react";
import { useHydrated } from "remix-utils/use-hydrated";
import { selectedBulkItemsAtom } from "~/atoms/list";
import { BulkUpdateDialogTrigger } from "~/components/bulk-update-dialog/bulk-update-dialog";
import { Button } from "~/components/shared/button";
import { MobileDropdownStyles } from "~/components/shared/mobile-dropdown-styles";
import When from "~/components/when/when";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
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
 * @returns A placeholder button before hydration, the live control after
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
 * One row of the panel.
 *
 * A row gets breathing room around its entry on small screens and sits flush
 * against the panel edge from `lg` up, where the entry button's own padding is
 * enough. `focus-within` lights the row up when that button takes focus, so
 * keyboard users can see which entry they are on.
 *
 * @param children - The entry's trigger button
 * @returns The wrapped row
 */
function PanelRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex select-none items-center px-2 py-1 focus-within:bg-slate-100 lg:p-0">
      {children}
    </div>
  );
}

/**
 * The hydrated control, with the dialogs it opens.
 *
 * @returns The trigger, the panel, and both booking dialogs
 */
function ConditionalActionsDropdown() {
  const [open, setOpen] = useState(false);
  const organization = useCurrentOrganization();
  const selectedModels = useAtomValue(selectedBulkItemsAtom);
  const roles = useOrganizationRoles();

  const canCreateBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.create,
  });
  const canAddToExistingBooking = userHasPermission({
    roles,
    entity: PermissionEntity.booking,
    action: PermissionAction.update,
  });

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

      <When truthy={canCreateBooking}>
        <CreateBookingForModelsDialog />
      </When>
      <When truthy={canAddToExistingBooking}>
        <AddModelsToExistingBookingDialog />
      </When>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            className="hidden sm:flex"
            disabled={disabledReason}
          >
            <span className="flex items-center gap-2">
              {buttonTitle} <ChevronRightIcon className="chev size-4" />
            </span>
          </Button>
        </PopoverTrigger>

        {/*
          Below `sm` the trigger above is hidden and this one opens the sheet.
          It only ever OPENS: the sheet is dismissed by tapping the overlay,
          which Radix reads as a pointer-down outside, and a toggle here would
          reopen what that dismissal just closed.
        */}
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

        <PopoverPortal>
          <PopoverContent
            // Matches the offsets the shared menu primitive applies, so the
            // panel sits the same distance from the trigger and keeps the same
            // gap from the viewport edge.
            sideOffset={4}
            collisionPadding={16}
            aria-label="Book selection"
            asChild
            className={tw(
              "z-50 w-screen overflow-y-auto rounded-t border border-gray-300 bg-white text-right shadow-md md:static md:w-56",
              // `MobileDropdownStyles` strips the popper transform below `sm`,
              // which detaches the panel from its trigger and turns it into a
              // bottom sheet. Trigger-relative available height no longer
              // describes the room it has, so cap it against the viewport and
              // let it scroll past that.
              "max-h-[85dvh] sm:max-h-[var(--radix-popover-content-available-height)]",
              "animate-in data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2"
            )}
          >
            <div className="fixed bottom-0 left-0">
              <When truthy={canCreateBooking}>
                <PanelRow>
                  <BulkUpdateDialogTrigger
                    type="model-bookings"
                    label="Create new booking"
                    onClick={closeMenu}
                    disabled={disabledReason}
                  />
                </PanelRow>
              </When>
              <When truthy={canAddToExistingBooking}>
                <PanelRow>
                  <BulkUpdateDialogTrigger
                    type="model-booking-exist"
                    label="Add to existing"
                    onClick={closeMenu}
                    disabled={disabledReason}
                  />
                </PanelRow>
              </When>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}
