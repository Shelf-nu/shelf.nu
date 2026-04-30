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
 * Menu items:
 *   - **Scan to assign** — links to the generic scan-assets drawer; the
 *     scan flow materialises the matching request via the shared
 *     `materializeModelRequestForAsset` helper. Rendered only when the
 *     booking is in a manage-eligible state.
 *   - **Remove reservation** — posts `DELETE` to the model-requests API
 *     via a fetcher. Only shown on DRAFT/RESERVED bookings with no
 *     materialised units (server-side guard in
 *     `removeBookingModelRequest` refuses otherwise; we just pre-gate
 *     the UI).
 *
 * @see {@link file://./asset-row-actions-dropdown.tsx} — pattern mirrored
 * @see {@link file://../../modules/booking-model-request/service.server.ts}
 *   — `removeBookingModelRequest` status + fulfilled-quantity guards
 */

import { forwardRef } from "react";
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
import { tw } from "~/utils/tw";
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
  fullWidth,
}: Props) => {
  // `skipDefault: true` — no auto-open-on-QR-scan behaviour for this row.
  const {
    ref: popoverContentRef,
    open,
    setOpen,
  } = useControlledDropdownMenu({ skipDefault: true });

  function handleMenuClose() {
    setOpen(false);
  }

  // Menu-item gating. Server-side guards (`upsertBookingModelRequest`,
  // `removeBookingModelRequest`) enforce the same constraints; this is
  // purely to pre-gate the UI so disabled items don't clutter the menu.
  const canScanToAssign =
    canManage && bookingStatus !== "COMPLETE" && bookingStatus !== "ARCHIVED";
  const canRemove =
    canManage &&
    (bookingStatus === "DRAFT" || bookingStatus === "RESERVED") &&
    request.fulfilledQuantity === 0;

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
