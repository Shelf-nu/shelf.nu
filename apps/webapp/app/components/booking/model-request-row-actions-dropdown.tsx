/**
 * Row actions dropdown for a `BookingModelRequest` in the booking
 * overview's Assets & Kits list (Phase 3d-Polish).
 *
 * Built on the Radix Popover primitive (DropdownMenu from
 * `~/components/shared/dropdown` is deprecated — see CLAUDE.md).
 * Markup, sizing, mobile sheet behaviour, and item-row styling are kept
 * **byte-identical** to {@link AssetRowActionsDropdown} so model-request
 * rows and asset rows feel like siblings in the list.
 *
 * Menu items, all of them gated on the booking still being live
 * (`canAssignModelUnits` / `canEditModelReservations` — the same statuses):
 *   - **Assign from list** — opens "Manage assets". Ticking a matching asset
 *     there discharges the reservation, because fulfilment is a property of an
 *     asset landing on the booking rather than of the scanner (see
 *     `fulfilModelRequestsForAssets`). Listed first: it is the only route that
 *     works without a camera or a scannable label.
 *   - **Scan to assign** — links to the generic scan-assets drawer. Same
 *     server path, same result, faster when you are holding the thing.
 *
 * Every label is short enough to sit on one line in the menu’s width. A
 * wrapping item grows its own row and the menu stops reading as a list of
 * equals — so reach for a shorter verb before a wider popover.
 *   - **Adjust quantity** — opens {@link AdjustModelReservationDialog}. The
 *     way a booking gives units back: reducing the reservation releases the
 *     unassigned remainder to every other booking competing for that window.
 *   - **Remove** — posts `DELETE` to the model-requests API via a fetcher.
 *     Only when nothing has been assigned yet; once units are on the booking
 *     the reservation is reduced instead, so those rows keep the record of how
 *     they got there.
 *
 * The server-side guards in `booking-model-request/service.server` are what
 * actually enforce all of this; the gating here only keeps the menu from
 * offering something that would come back as an error.
 *
 * @see {@link file://./asset-row-actions-dropdown.tsx} — pattern mirrored
 * @see {@link file://./adjust-model-reservation-dialog.tsx}
 * @see {@link file://../../modules/booking-model-request/service.server.ts}
 */

import { forwardRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { BookingStatus } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useFetcher } from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { TrashIcon, VerticalDotsIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { useDisabled } from "~/hooks/use-disabled";
import {
  canAssignModelUnits,
  canEditModelReservations,
} from "~/utils/booking-model-requests";
import { tw } from "~/utils/tw";
import { AdjustModelReservationDialog } from "./adjust-model-reservation-dialog";
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

type ModelRequest = {
  assetModelId: string;
  quantity: number;
  fulfilledQuantity: number;
  assetModel: { name: string };
};

interface Props {
  request: ModelRequest;
  bookingId: string;
  bookingStatus: BookingStatus;
  /** Whether the operator can still mutate assets on this booking
   *  (mirrors `manageAssetsButtonDisabled`). When false the menu has no
   *  actionable items and the whole popover is skipped. */
  canManage: boolean;
  /**
   * Destination for "Assign from list" — the booking-window-filtered
   * `manage-assets` URL built by the parent. Required rather than defaulted:
   * an unfiltered picker lists assets that cannot legally be added, and a
   * silent fallback is exactly how the two entry points drifted apart.
   */
  manageAssetsUrl: string;
  fullWidth?: boolean;
}

/**
 * Kebab trigger button. Uses `forwardRef` + `{...props}` spread so
 * Radix's `PopoverTrigger asChild` can attach its handlers and ref. The
 * same component is reused as the SSR fallback so the trigger's shape
 * doesn't jump during hydration.
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
TriggerButton.displayName = "ModelRequestRowActionsTrigger";

const ConditionalActionsDropdown = ({
  request,
  bookingId,
  bookingStatus,
  canManage,
  manageAssetsUrl,
  fullWidth,
}: Props) => {
  // `skipDefault: true` — no auto-open-on-QR-scan behaviour for this row.
  const {
    ref: popoverContentRef,
    open,
    setOpen,
  } = useControlledDropdownMenu({ skipDefault: true });
  const [isAdjustDialogOpen, setIsAdjustDialogOpen] = useState(false);

  function handleMenuClose() {
    setOpen(false);
  }

  // Menu-item gating. Server-side guards (`upsertBookingModelRequest`,
  // `removeBookingModelRequest`) enforce the same constraints; this is
  // purely to pre-gate the UI so disabled items don't clutter the menu.
  const canScanToAssign = canManage && canAssignModelUnits(bookingStatus);
  const canAdjust = canManage && canEditModelReservations(bookingStatus);
  // Deleting the row while units hang off it would cut them loose from the
  // record of how they got onto the booking. Reducing the quantity is the
  // route out in that case, which "Adjust quantity" offers directly.
  const canRemove = canAdjust && request.fulfilledQuantity === 0;

  const scanUrl = `/bookings/${bookingId}/overview/scan-assets`;

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
            className="order actions-dropdown static z-[99] !mt-0 w-screen rounded-b-none rounded-t-[4px] border border-gray-300 bg-white p-0 text-right md:static md:mt-auto md:w-[200px] md:rounded-t-[4px]"
          >
            <div className="order fixed bottom-0 left-0 w-screen rounded-b-none rounded-t-[4px] bg-white p-0 text-right md:static md:w-full md:rounded-t-[4px]">
              {canScanToAssign ? (
                <>
                  <div className="border-b px-0 py-1 md:p-0">
                    <Button
                      to={manageAssetsUrl}
                      variant="link"
                      icon="asset"
                      className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
                      onClick={handleMenuClose}
                    >
                      Assign from list
                    </Button>
                  </div>

                  <div className="border-b px-0 py-1 md:p-0">
                    <Button
                      to={scanUrl}
                      variant="link"
                      icon="scan"
                      className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
                      onClick={handleMenuClose}
                    >
                      Scan to assign
                    </Button>
                  </div>
                </>
              ) : null}

              {canAdjust ? (
                <div className="border-b px-0 py-1 md:p-0">
                  <Button
                    type="button"
                    variant="link"
                    icon="adjust-quantity"
                    className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                    width="full"
                    onClick={() => {
                      setIsAdjustDialogOpen(true);
                      handleMenuClose();
                    }}
                  >
                    Adjust quantity
                  </Button>
                </div>
              ) : null}

              {canRemove ? (
                <div className="border-b px-0 py-1 md:p-0">
                  <RemoveReservation
                    request={request}
                    bookingId={bookingId}
                    trigger={
                      <Button
                        type="button"
                        variant="link"
                        icon="trash"
                        className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                        width="full"
                      >
                        Remove
                      </Button>
                    }
                    onRequestClose={handleMenuClose}
                  />
                </div>
              ) : null}

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

      {/* Outside the Popover: the menu closes as the dialog opens, and a
          dialog nested in the popover tree would unmount with it. */}
      {canAdjust ? (
        <AdjustModelReservationDialog
          bookingId={bookingId}
          assetModelId={request.assetModelId}
          modelName={request.assetModel.name}
          quantity={request.quantity}
          fulfilledQuantity={request.fulfilledQuantity}
          open={isAdjustDialogOpen}
          onOpenChange={setIsAdjustDialogOpen}
        />
      ) : null}
    </>
  );
};

/**
 * Export matches the shape of `AssetRowActionsDropdown` (named export,
 * not default) so consumers that import both stay consistent.
 */
export const ModelRequestRowActionsDropdown = ({
  request,
  bookingId,
  bookingStatus,
  canManage,
  manageAssetsUrl,
  fullWidth,
}: Props) => {
  // SSR fallback: render a static trigger until hydration so server
  // and client markup agree. Matches the pattern in
  // `location/actions-dropdown` and `generic-add-to-bookings-actions-dropdown`.
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return <TriggerButton fullWidth={fullWidth} />;
  }

  // No actionable items → render nothing rather than an empty menu.
  if (!canManage) {
    return null;
  }

  return (
    <div
      className={tw(
        "actions-dropdown flex justify-end",
        fullWidth ? "w-full" : ""
      )}
    >
      <ConditionalActionsDropdown
        request={request}
        bookingId={bookingId}
        bookingStatus={bookingStatus}
        canManage={canManage}
        manageAssetsUrl={manageAssetsUrl}
        fullWidth={fullWidth}
      />
    </div>
  );
};

/**
 * Remove-reservation flow: alert dialog → fetcher POST/DELETE. Extracted
 * into its own component so the popover item can pass a styled `trigger`
 * without dragging the full alert + form markup into the popover tree
 * (mirrors how `RemoveAssetFromBooking` wraps asset-row removal).
 *
 * Keyed fetcher prevents cross-row loading-state bleed when multiple
 * model-request rows render their dropdowns concurrently.
 */
function RemoveReservation({
  request,
  bookingId,
  trigger,
  onRequestClose,
}: {
  request: ModelRequest;
  bookingId: string;
  trigger: ReactNode;
  onRequestClose?: () => void;
}) {
  const fetcher = useFetcher({
    key: `booking-model-request-remove-${request.assetModelId}`,
  });
  const disabled = useDisabled(fetcher);

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mx-auto md:m-0">
            <span className="flex size-12 items-center justify-center rounded-full bg-error-50 p-2 text-error-600">
              <TrashIcon />
            </span>
          </div>
          <AlertDialogTitle>
            Remove reservation for "{request.assetModel.name}"
          </AlertDialogTitle>
          <AlertDialogDescription>
            This cancels the {request.quantity}-unit model-level reservation.
            The booking stays in place — you can add a new reservation or
            specific assets afterwards.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <div className="flex justify-center gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={disabled}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <fetcher.Form
              method="DELETE"
              action={`/api/bookings/${bookingId}/model-requests`}
              onSubmit={() => onRequestClose?.()}
            >
              <input
                type="hidden"
                name="assetModelId"
                value={request.assetModelId}
              />
              <Button type="submit" disabled={disabled}>
                Remove
              </Button>
            </fetcher.Form>
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
