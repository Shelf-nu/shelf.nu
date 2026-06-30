/**
 * Row actions dropdown for each kit in a booking's asset list.
 *
 * Mirrors `asset-row-actions-dropdown.tsx` exactly — same Popover-based
 * primitive (DropdownMenu from `~/components/shared/dropdown` is deprecated,
 * see CLAUDE.md), same mobile/desktop sizing, same item-row chrome:
 *
 * - Mobile: full-width bottom sheet with a dim overlay + a "Close" button.
 * - Desktop: right-aligned 180px menu anchored under the trigger.
 * - Item rows: wrapped in `<div className="border-b px-0 py-1 md:p-0">`,
 *   buttons use `px-4 py-3` with `hover:bg-slate-100` matching the asset row.
 *
 * Currently exposes a single action — "Remove" — which confirms via an
 * AlertDialog. The Popover stays as the outer chrome; the AlertDialog is
 * nested as the trigger's content, so the menu closes cleanly when the
 * confirm dialog opens.
 */

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import type { Kit } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Form, useLoaderData } from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { useBookingStatusHelpers } from "~/hooks/use-booking-status";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useDisabled } from "~/hooks/use-disabled";
import type { BookingWithCustodians } from "~/modules/booking/types";
import { tw } from "~/utils/tw";
import { TrashIcon, VerticalDotsIcon } from "../icons/library";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";

interface Props {
  kit: Pick<Kit, "id" | "name">;
  fullWidth?: boolean;
}

/**
 * Kebab trigger button.
 *
 * Uses `forwardRef` + `{...props}` spread so Radix's `PopoverTrigger asChild`
 * can attach its event handlers (onClick/onPointerDown/onKeyDown) and ref to
 * the underlying `<button>`. Same component is reused as the SSR fallback so
 * the shape/size never jumps during hydration.
 */
type TriggerButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean;
};

const TriggerButton = forwardRef<HTMLButtonElement, TriggerButtonProps>(
  ({ fullWidth, className, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      aria-label="Actions Trigger"
      {...props}
      className={tw("asset-actions", fullWidth ? "w-full" : "", className)}
    >
      <span className="flex size-6 items-center justify-center gap-2 text-center">
        <VerticalDotsIcon />
      </span>
    </button>
  )
);
TriggerButton.displayName = "KitRowActionsTrigger";

function ConditionalActionsDropdown({ kit, fullWidth }: Props) {
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const { isArchived, isCompleted } = useBookingStatusHelpers(booking.status);
  const disabled = useDisabled();

  /**
   * `skipDefault: true` — we don't want the hook's auto-open-on-QR-scan
   * behavior for this row menu.
   */
  const {
    ref: popoverContentRef,
    open,
    setOpen,
  } = useControlledDropdownMenu({ skipDefault: true });

  function handleMenuClose() {
    setOpen(false);
  }

  const removeDisabled = isArchived || isCompleted;

  return (
    <>
      {open && (
        <div
          className={tw(
            "fixed right-0 top-0 z-10 h-screen w-screen cursor-pointer bg-gray-700/50 transition duration-300 ease-in-out md:hidden"
          )}
        />
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <TriggerButton fullWidth={fullWidth} className="hidden sm:flex" />
        </PopoverTrigger>

        {/* Custom mobile trigger that only opens (never toggles) — matches
            the pattern used by other Popover menus to avoid conflicts with
            the dim overlay on mobile. */}
        <TriggerButton
          fullWidth={fullWidth}
          className="sm:hidden"
          onClick={() => setOpen(true)}
        />

        <PopoverPortal>
          <PopoverContent
            ref={popoverContentRef}
            tabIndex={-1}
            align="end"
            side="bottom"
            sideOffset={4}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              popoverContentRef.current?.focus();
            }}
            className="order actions-dropdown static z-[99] !mt-0 w-screen rounded-b-none rounded-t-[4px] border border-gray-300 bg-white p-0 text-right md:static md:mt-auto md:w-[180px] md:rounded-t-[4px]"
          >
            <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-full md:rounded-t-[4px]">
              <div className="border-b px-0 py-1 md:p-0">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="link"
                      icon="trash"
                      className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
                      title={
                        removeDisabled
                          ? "Cannot remove assets from completed bookings"
                          : undefined
                      }
                      disabled={removeDisabled}
                    >
                      Remove
                    </Button>
                  </AlertDialogTrigger>

                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <div className="mx-auto md:m-0">
                        <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
                          <TrashIcon />
                        </span>
                      </div>
                      <AlertDialogTitle>
                        Remove "{kit.name}" from booking
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        Are you sure you want to remove this kit from the
                        booking?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <div className="flex justify-center gap-2">
                        <AlertDialogCancel asChild>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={disabled}
                          >
                            Cancel
                          </Button>
                        </AlertDialogCancel>

                        <Form method="post" onSubmit={handleMenuClose}>
                          <input type="hidden" name="kitId" value={kit.id} />
                          <Button
                            type="submit"
                            name="intent"
                            value="removeKit"
                            disabled={disabled}
                          >
                            Remove
                          </Button>
                        </Form>
                      </div>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="border-t p-4 md:hidden md:p-0">
                <Button
                  type="button"
                  role="button"
                  variant="secondary"
                  className="flex items-center justify-center text-gray-700 hover:text-gray-700"
                  width="full"
                  onClick={handleMenuClose}
                >
                  Close
                </Button>
              </div>
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </>
  );
}

export default function KitRowActionsDropdown({ kit, fullWidth }: Props) {
  /**
   * SSR fallback: render a static trigger until hydration so server and
   * client markup agree. Matches the pattern in `asset-row-actions-dropdown`,
   * `location/actions-dropdown`, and `generic-add-to-bookings-actions-dropdown`.
   */
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return <TriggerButton fullWidth={fullWidth} />;
  }

  return (
    <div
      className={tw(
        // `justify-end` pins the kebab to the right of its cell so it
        // aligns vertically with the asset rows' kebab cluster — without
        // this the kit kebab would sit at the left of its cell creating
        // a column-alignment mismatch between asset and kit rows.
        "actions-dropdown flex justify-end",
        fullWidth ? "w-full" : ""
      )}
    >
      <ConditionalActionsDropdown kit={kit} fullWidth={fullWidth} />
    </div>
  );
}
