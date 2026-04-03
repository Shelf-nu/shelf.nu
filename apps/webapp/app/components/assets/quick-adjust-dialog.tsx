/**
 * Quick Adjust Dialog
 *
 * A dialog component for quickly adjusting the quantity of a QUANTITY_TRACKED
 * asset. Provides two actions: "Add" (restock) and "Remove" (loss), each
 * submitting to the `/api/assets/adjust-quantity` endpoint via a fetcher.
 *
 * Designed to be triggered from the QuantityOverviewCard on the asset detail
 * page. Supports an optional `autoOpen` prop for QR-scan-triggered flows.
 *
 * @see {@link file://../../routes/api+/assets.adjust-quantity.ts} - API endpoint
 * @see {@link file://./quantity-overview-card.tsx} - Trigger location
 */

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
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

/** Props for the QuickAdjustDialog component */
export interface QuickAdjustDialogProps {
  /** The ID of the asset to adjust */
  assetId: string;
  /** The trigger element that opens the dialog */
  trigger: ReactNode;
  /** Optional unit of measure label (e.g., "pcs", "liters") */
  unitOfMeasure?: string | null;
  /** When true, the dialog opens automatically on mount (e.g., after QR scan) */
  autoOpen?: boolean;
}

/**
 * Dialog for quickly adding or removing stock from a quantity-tracked asset.
 *
 * Uses a fetcher to POST to `/api/assets/adjust-quantity`. The dialog
 * auto-closes on successful submission and resets its form fields.
 *
 * @param props - Dialog configuration
 * @returns AlertDialog component with quantity adjustment form
 */
export function QuickAdjustDialog({
  assetId,
  trigger,
  unitOfMeasure,
  autoOpen = false,
}: QuickAdjustDialogProps) {
  const [open, setOpen] = useState(autoOpen);
  const fetcher = useFetcher({ key: "adjust-quantity" });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);

  const unitLabel = unitOfMeasure || "units";
  const isSubmitting = isFormProcessing(fetcher.state);

  /** Close the dialog and reset the form after a successful submission */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setOpen(false);
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data]);

  /**
   * Submits the adjustment form with the given direction and category.
   * "Add" maps to direction=add, category=RESTOCK.
   * "Remove" maps to direction=subtract, category=LOSS.
   */
  function handleSubmit(direction: "add" | "subtract") {
    const form = formRef.current;
    if (!form) return;

    const formData = new FormData(form);
    formData.set("direction", direction);
    formData.set("category", direction === "add" ? "RESTOCK" : "LOSS");

    void fetcher.submit(formData, {
      method: "POST",
      action: "/api/assets/adjust-quantity",
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Adjust Quantity</AlertDialogTitle>
          <AlertDialogDescription>
            Add or remove stock for this asset. Enter the number of {unitLabel}{" "}
            to adjust.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form
          ref={formRef}
          method="POST"
          action="/api/assets/adjust-quantity"
        >
          <input type="hidden" name="assetId" value={assetId} />

          <div className="flex flex-col gap-4">
            <Input
              name="quantity"
              type="number"
              label={`Quantity (${unitLabel})`}
              placeholder="Enter quantity"
              min={1}
              step={1}
              required
              autoFocus
              data-dialog-initial-focus
            />

            <Input
              name="note"
              inputType="textarea"
              label="Note (optional)"
              placeholder="Reason for adjustment..."
              rows={3}
            />
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
            variant="secondary"
            onClick={() => handleSubmit("subtract")}
            disabled={disabled}
            className="text-error-600 hover:text-error-700"
          >
            {isSubmitting ? "Removing..." : "Remove"}
          </Button>

          <Button
            type="button"
            variant="primary"
            onClick={() => handleSubmit("add")}
            disabled={disabled}
          >
            {isSubmitting ? "Adding..." : "Add"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
