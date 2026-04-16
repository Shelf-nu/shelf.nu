/**
 * Row actions dropdown for each asset in a booking's asset list.
 *
 * Uses the Radix Popover primitive (DropdownMenu from `~/components/shared/dropdown`
 * is deprecated — see CLAUDE.md). Design, sizing, and interaction design are
 * kept identical to other Popover-based action menus in the app, particularly
 * `components/location/actions-dropdown.tsx` and
 * `components/shared/generic-add-to-bookings-actions-dropdown.tsx`:
 *
 * - Mobile: full-width bottom sheet with a dim overlay + a "Close" button.
 * - Desktop: right-aligned 180px menu anchored under the trigger.
 * - Item rows: wrapped in `<div className="border-b px-0 py-1 md:p-0">`,
 *   buttons use `px-4 py-3` with `hover:bg-slate-100` matching the other
 *   Popover menus.
 *
 * For QUANTITY_TRACKED assets, shows an "Adjust quantity" action that
 * opens a modal to change the booked quantity. Auto-opens that modal when
 * the URL carries `?adjustQty=<assetId>` (used when redirecting from
 * "Create new booking" for a qty-tracked asset).
 */

import { forwardRef, useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes } from "react";
import type { Asset } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useLoaderData } from "react-router";
import { useHydrated } from "remix-utils/use-hydrated";
import { VerticalDotsIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { useSearchParams } from "~/hooks/search-params";
import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { BookingWithCustodians } from "~/modules/booking/types";
import { tw } from "~/utils/tw";
import { AdjustBookingAssetQuantityDialog } from "./adjust-booking-asset-quantity-dialog";
import { RemoveAssetFromBooking } from "./remove-asset-from-booking";

interface Props {
  /** The asset. For qty-tracked assets, must include `bookedQuantity` (attached by loader). */
  asset: Asset & { bookedQuantity?: number | null };
  fullWidth?: boolean;
}

/**
 * Kebab trigger button.
 *
 * Uses `forwardRef` + `{...props}` spread so Radix's `PopoverTrigger asChild`
 * can attach its event handlers (onClick/onPointerDown/onKeyDown) and ref to
 * the underlying `<button>` — without this the popover won't open. Same
 * component is reused as the SSR fallback so the shape/size never jumps
 * during hydration.
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
TriggerButton.displayName = "AssetRowActionsTrigger";

const ConditionalActionsDropdown = ({ asset, fullWidth }: Props) => {
  const { booking } = useLoaderData<{ booking: BookingWithCustodians }>();
  const [isAdjustDialogOpen, setIsAdjustDialogOpen] = useState(false);
  const isQtyTracked = isQuantityTracked(asset);

  /**
   * `skipDefault: true` — we don't want the hook's auto-open-on-QR-scan
   * behavior for this row menu. Our auto-open is handled separately via
   * `?adjustQty=<assetId>` and targets the dialog, not the popover.
   */
  const {
    ref: popoverContentRef,
    open,
    setOpen,
  } = useControlledDropdownMenu({ skipDefault: true });

  function handleMenuClose() {
    setOpen(false);
  }

  /**
   * Auto-open the Adjust Quantity dialog when the overview route is entered
   * with `?adjustQty=<assetId>` matching this row. Fires after "Create new
   * booking" from an asset page for a qty-tracked asset so the user lands
   * in the booking with the quantity picker already open.
   *
   * Guarded with a ref so it runs exactly once per mount. Why: the custom
   * `useSearchParams` hook returns an *unstable* `setSearchParams` (new
   * function reference every render), so this effect re-fires on every
   * render. Without the ref, `setSearchParams` (navigation) is scheduled
   * each time before the URL actually updates — which caused an infinite
   * revalidation loop that hammered the root `_layout` loader and tripped
   * Stripe's rate limit. The ref also means we intentionally DON'T react
   * to later URL changes that happen to contain `adjustQty` — only the
   * param present at mount triggers auto-open.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const didAutoOpenRef = useRef(false);
  useEffect(() => {
    if (didAutoOpenRef.current) return;
    if (!isQtyTracked) return;
    if (searchParams.get("adjustQty") !== asset.id) return;

    didAutoOpenRef.current = true;
    setIsAdjustDialogOpen(true);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("adjustQty");
        return next;
      },
      { replace: true, preventScrollReset: true }
    );
  }, [asset.id, isQtyTracked, searchParams, setSearchParams]);

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

        {/* Custom mobile trigger that only opens (never toggles) — matches the
            pattern used by other Popover menus to avoid conflicts with the
            dim overlay on mobile. */}
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
              {isQtyTracked ? (
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

              <div className="border-b px-0 py-1 md:p-0">
                <RemoveAssetFromBooking
                  asset={asset}
                  trigger={
                    <Button
                      type="button"
                      variant="link"
                      data-test-id="deleteBookingButton"
                      icon="trash"
                      className="justify-start px-4 py-3 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
                      width="full"
                    >
                      Remove
                    </Button>
                  }
                />
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

      {isQtyTracked ? (
        <AdjustBookingAssetQuantityDialog
          bookingId={booking.id}
          assetId={asset.id}
          assetTitle={asset.title}
          currentQuantity={asset.bookedQuantity ?? 1}
          maxQuantity={asset.quantity ?? undefined}
          unitOfMeasure={asset.unitOfMeasure}
          open={isAdjustDialogOpen}
          onOpenChange={setIsAdjustDialogOpen}
        />
      ) : null}
    </>
  );
};

export const AssetRowActionsDropdown = ({ asset, fullWidth }: Props) => {
  /**
   * SSR fallback: render a static trigger until hydration so server and
   * client markup agree. Matches the pattern in `location/actions-dropdown`
   * and `generic-add-to-bookings-actions-dropdown`.
   */
  const isHydrated = useHydrated();

  if (!isHydrated) {
    return <TriggerButton fullWidth={fullWidth} />;
  }

  return (
    <div className={tw("actions-dropdown flex", fullWidth ? "w-full" : "")}>
      <ConditionalActionsDropdown asset={asset} fullWidth={fullWidth} />
    </div>
  );
};
