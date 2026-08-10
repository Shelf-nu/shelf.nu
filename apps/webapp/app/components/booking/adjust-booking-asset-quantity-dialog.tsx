/**
 * Adjust Booking Asset Quantity Dialog
 *
 * Dialog for changing the booked quantity of a single QUANTITY_TRACKED
 * asset inside a booking. Submits to the
 * `/api/bookings/:bookingId/adjust-asset-quantity` endpoint via fetcher.
 *
 * Supports controlled mode (open + onOpenChange) for cases where the
 * dialog is opened programmatically (e.g., auto-open after create-new
 * booking with a qty-tracked asset).
 *
 * @see {@link file://../../routes/api+/bookings.$bookingId.adjust-asset-quantity.ts}
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isFormProcessing } from "~/utils/form";

/** Props for the AdjustBookingAssetQuantityDialog component */
export interface AdjustBookingAssetQuantityDialogProps {
  /** The booking ID — used to build the API endpoint URL */
  bookingId: string;
  /** The asset ID whose booked quantity we're adjusting */
  assetId: string;
  /** The asset title, shown in the dialog for context */
  assetTitle?: string;
  /** The currently booked quantity (pre-fills the input) */
  currentQuantity: number;
  /**
   * Maximum quantity the user can INCREASE to. In the booking context this
   * is the real windowed max for the booking's dates (`bookable` from
   * `~/modules/booking/booking-overview-availability.server`) — NOT the
   * workspace total, since other overlapping bookings may already hold
   * some units. Still caps the number input's `max` attribute, but
   * decreases below `currentQuantity` are always allowed client-side even
   * when `currentQuantity` already exceeds this (see `handleSubmit`) so an
   * already-over-committed row stays editable-down.
   */
  maxQuantity?: number;
  /**
   * Workspace total stock (`Asset.quantity`). When provided, the helper
   * text switches from the plain "Max: N" line (custody-list usage) to
   * "Available for these dates: {maxQuantity} of {totalQuantity}" so the
   * user understands `maxQuantity` is a windowed figure, not the full
   * stock. Omit for non-booking usages (e.g. custody release) to keep the
   * original "Max: N" copy.
   */
  totalQuantity?: number;
  /**
   * Units held by OTHER bookings within this booking's window
   * (`reserved` from the same builder). When > 0 and `totalQuantity` is
   * provided, an extra helper line explains why the max is below the
   * workspace total: "Some units are also reserved by other bookings."
   */
  reservedByOthers?: number;
  /**
   * The booking's window (start / end). When provided, the "Available for …"
   * helper names the ACTUAL dates instead of the generic "these dates".
   */
  windowFrom?: string | Date | null;
  windowTo?: string | Date | null;
  /** Unit of measure label (e.g., "pcs", "liters") */
  unitOfMeasure?: string | null;
  /** Trigger element. Omit when using controlled mode. */
  trigger?: ReactNode;
  /** Controlled open state */
  open?: boolean;
  /** Controlled open-change callback */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Dialog for adjusting the booked quantity of a single asset.
 *
 * Uses a fetcher to POST to `/api/bookings/:bookingId/adjust-asset-quantity`.
 * Auto-closes on success. Shows inline validation error if the requested
 * quantity exceeds the allowed maximum.
 */
export function AdjustBookingAssetQuantityDialog({
  bookingId,
  assetId,
  assetTitle,
  currentQuantity,
  maxQuantity,
  totalQuantity,
  reservedByOthers,
  windowFrom,
  windowTo,
  unitOfMeasure,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AdjustBookingAssetQuantityDialogProps) {
  // Owners/admins may see how OTHER bookings compete for the pool (a count +
  // a link to resolve); self-service/base users only get the generic note —
  // they can't view other people's bookings.
  const { isBaseOrSelfService } = useUserRoleHelper();
  const canViewOtherBookings = !isBaseOrSelfService;
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (isControlled) {
        controlledOnOpenChange?.(v);
      } else {
        setInternalOpen(v);
      }
    },
    [isControlled, controlledOnOpenChange]
  );

  const [quantityError, setQuantityError] = useState<string | null>(null);
  const fetcher = useFetcher({ key: `adjust-booking-asset-${assetId}` });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);
  // Replaces `autoFocus` to satisfy jsx-a11y/no-autofocus while keeping the
  // intentional modal-open focus UX. The hook handles the rAF-defer needed
  // for the Radix portal mount and re-focuses on every closed → open flip.
  const quantityInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  const unitLabel = unitOfMeasure || "units";
  const isSubmitting = isFormProcessing(fetcher.state);

  /** Server-side error message from the action response */
  const serverError =
    fetcher.data?.error != null
      ? (fetcher.data.error as { message?: string })?.message
      : null;

  /** Close on success */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setOpen(false);
      setQuantityError(null);
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data, setOpen]);

  /** Submit with client-side validation */
  function handleSubmit() {
    const form = formRef.current;
    if (!form) return;

    const formData = new FormData(form);
    const qty = Number(formData.get("quantity"));

    if (!Number.isInteger(qty) || qty < 1) {
      setQuantityError("Quantity must be a whole number greater than 0.");
      return;
    }

    // Block genuine attempts to go ABOVE the max, but never block a
    // reduction (or a no-op resubmit) below `currentQuantity` — an
    // already-over-committed row (currentQuantity > maxQuantity, e.g. the
    // window shrank after another booking grabbed units) must stay
    // editable-down. The server guard is the real source of truth; this is
    // purely a client-side UX nicety.
    if (maxQuantity != null && qty > maxQuantity && qty > currentQuantity) {
      setQuantityError(
        `Only ${maxQuantity} ${unitLabel} available. Please reduce the quantity.`
      );
      return;
    }

    setQuantityError(null);
    void fetcher.submit(formData, {
      method: "POST",
      action: `/api/bookings/${bookingId}/adjust-asset-quantity`,
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Adjust booked quantity</AlertDialogTitle>
          <AlertDialogDescription>
            Set how many {unitLabel} of
            {assetTitle ? ` "${assetTitle}"` : " this asset"} to reserve for
            this booking.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form
          ref={formRef}
          method="POST"
          action={`/api/bookings/${bookingId}/adjust-asset-quantity`}
        >
          <input type="hidden" name="assetId" value={assetId} />

          <div className="flex flex-col gap-4">
            <Input
              ref={quantityInputRef}
              name="quantity"
              type="number"
              label={`Quantity (${unitLabel})`}
              min={1}
              max={maxQuantity ?? undefined}
              step={1}
              required
              defaultValue={currentQuantity}
              error={quantityError || serverError || undefined}
              onChange={() => setQuantityError(null)}
            />
            {maxQuantity != null ? (
              totalQuantity != null ? (
                // Booking context: `maxQuantity` is the windowed figure for
                // THESE dates, not the workspace total — spell that out so
                // "Max: 3" doesn't read as "we only own 3 of these".
                <div className="-mt-2 flex flex-col gap-0.5">
                  {/* Hero: the number the user most needs — how many they can
                      book for these dates — reads first and boldest. */}
                  <p className="text-xs font-semibold text-gray-700">
                    {maxQuantity} of {totalQuantity} {unitLabel} available
                  </p>
                  <p className="text-xs text-gray-500">
                    {windowFrom && windowTo ? (
                      <>
                        for <DateS date={windowFrom} /> –{" "}
                        <DateS date={windowTo} />
                      </>
                    ) : (
                      "for the selected dates"
                    )}
                  </p>
                  {reservedByOthers != null && reservedByOthers > 0 ? (
                    canViewOtherBookings ? (
                      <p className="text-xs text-gray-500">
                        {reservedByOthers} {unitLabel} reserved by other
                        bookings.{" "}
                        <Link
                          to={`/assets/${assetId}/bookings`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-primary underline"
                        >
                          View bookings
                        </Link>
                      </p>
                    ) : (
                      <p className="text-xs text-gray-500">
                        Some units are also reserved by other bookings.
                      </p>
                    )
                  ) : null}
                </div>
              ) : (
                // Non-booking usage (e.g. custody release) — no workspace
                // total to compare against, so keep the plain figure.
                <p className="-mt-2 text-xs text-gray-500">
                  Max: {maxQuantity} {unitLabel}
                </p>
              )
            ) : null}
          </div>
        </fetcher.Form>

        <AlertDialogFooter className="mt-4 gap-2">
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary" disabled={isSubmitting}>
              Cancel
            </Button>
          </AlertDialogCancel>

          <Button
            type="button"
            variant="primary"
            onClick={handleSubmit}
            disabled={disabled}
          >
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
