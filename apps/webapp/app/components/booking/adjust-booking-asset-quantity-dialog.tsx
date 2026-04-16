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
import { useFetcher } from "react-router";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
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
import { useDisabled } from "~/hooks/use-disabled";
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
  /** Maximum quantity the user can set (available + currently booked) */
  maxQuantity?: number;
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
  unitOfMeasure,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AdjustBookingAssetQuantityDialogProps) {
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

    if (maxQuantity != null && qty > maxQuantity) {
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
              name="quantity"
              type="number"
              label={`Quantity (${unitLabel})`}
              min={1}
              max={maxQuantity ?? undefined}
              step={1}
              required
              autoFocus
              defaultValue={currentQuantity}
              error={quantityError || serverError || undefined}
              onChange={() => setQuantityError(null)}
            />
            {maxQuantity != null ? (
              <p className="-mt-2 text-xs text-gray-500">
                Max: {maxQuantity} {unitLabel}
              </p>
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
