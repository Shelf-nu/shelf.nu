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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { isFormProcessing } from "~/utils/form";

/** Props for the QuickAdjustDialog component */
export interface QuickAdjustDialogProps {
  /** The ID of the asset to adjust */
  assetId: string;
  /** The trigger element that opens the dialog. Omit when using controlled mode. */
  trigger?: ReactNode;
  /** Optional unit of measure label (e.g., "pcs", "liters") */
  unitOfMeasure?: string | null;
  /** Maximum quantity that can be removed (available = total - inCustody) */
  availableQuantity?: number;
  /** Controlled open state — when provided, the dialog is externally controlled */
  open?: boolean;
  /** Callback when the dialog open state changes (controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** The current total quantity of the asset */
  totalQuantity?: number | null;
}

/**
 * Dialog for quickly adding or removing stock from a quantity-tracked asset.
 * Supports relative adjustments (Add/Remove) or setting an absolute new total.
 *
 * Supports two modes:
 * - **Uncontrolled** (default): Pass a `trigger` element. The dialog manages
 *   its own open/close state via `AlertDialogTrigger`.
 * - **Controlled**: Pass `open` and `onOpenChange` props. Useful when the
 *   dialog must render outside a parent popover to avoid portal conflicts.
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
  availableQuantity,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  totalQuantity,
}: QuickAdjustDialogProps) {
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
  /** Client-side validation error for the quantity field */
  const [quantityError, setQuantityError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"adjust" | "total">("adjust");
  const fetcher = useFetcher({ key: "adjust-quantity" });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);
  // Replaces `autoFocus` to satisfy jsx-a11y/no-autofocus. The hook
  // re-focuses on every closed → open flip and handles the rAF defer
  // needed for the Radix portal mount. `data-dialog-initial-focus` is the
  // layout/Dialog convention and is dead inside AlertDialog, so the
  // hook-driven ref is the source of truth here.
  const quantityInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  const unitLabel = unitOfMeasure || "units";
  const isSubmitting = isFormProcessing(fetcher.state);

  /** Server-side error message from the action response */
  const serverError =
    fetcher.data?.error != null
      ? (fetcher.data.error as { message?: string })?.message
      : null;

  /** Close the dialog and reset the form after a successful submission */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setOpen(false);
      setQuantityError(null);
      formRef.current?.reset();
      setActiveTab("adjust");
    }
  }, [fetcher.state, fetcher.data, setOpen]);

  useEffect(() => {
    if (!open) {
      setQuantityError(null);
      formRef.current?.reset();
      setActiveTab("adjust");
    }
  }, [open]);

  /**
   * Submits the adjustment form with the given direction and category.
   * "Add" maps to direction=add, category=RESTOCK.
   * "Remove" maps to direction=subtract, category=LOSS.
   *
   * For "subtract", validates that the quantity does not exceed the
   * available amount (total minus in-custody).
   */
  function handleSubmit(direction: "add" | "subtract") {
    const form = formRef.current;
    if (!form) return;

    const formData = new FormData(form);
    const qty = Number(formData.get("quantity"));

    if (isNaN(qty) || qty <= 0) {
      setQuantityError("Quantity must be a positive number.");
      return;
    }

    /** Client-side guard: can't remove more than available */
    if (
      direction === "subtract" &&
      availableQuantity != null &&
      qty > availableQuantity
    ) {
      setQuantityError(
        `Cannot remove ${qty} ${unitLabel}. Only ${availableQuantity} available (the rest is in custody).`
      );
      return;
    }

    setQuantityError(null);
    formData.set("direction", direction);
    formData.set("category", direction === "add" ? "RESTOCK" : "LOSS");

    void fetcher.submit(formData, {
      method: "POST",
      action: "/api/assets/adjust-quantity",
    });
  }

  /**
   * Submits the absolute total adjustment form by calculating the difference.
   */
  function handleSetTotal() {
    const form = formRef.current;
    if (!form || totalQuantity === undefined || totalQuantity === null) return;

    const formData = new FormData(form);
    const newTotalVal = formData.get("newTotal");
    if (newTotalVal === null || newTotalVal === "") {
      setQuantityError("Please enter a new total quantity.");
      return;
    }
    const newTotal = Number(newTotalVal);

    if (isNaN(newTotal) || newTotal < 0) {
      setQuantityError("New total must be a non-negative number.");
      return;
    }

    if (newTotal === totalQuantity) {
      setQuantityError("New total is the same as the current total quantity.");
      return;
    }

    if (newTotal > totalQuantity) {
      const diff = newTotal - totalQuantity;
      formData.set("quantity", String(diff));
      formData.set("direction", "add");
      formData.set("category", "RESTOCK");
    } else {
      const diff = totalQuantity - newTotal;

      /** Client-side guard: can't remove more than available */
      if (availableQuantity != null && diff > availableQuantity) {
        const minNewTotal = totalQuantity - availableQuantity;
        setQuantityError(
          `Cannot reduce total to ${newTotal} ${unitLabel}. This would remove ${diff} ${unitLabel}, but only ${availableQuantity} are available (the rest is in custody). Minimum total allowed is ${minNewTotal} ${unitLabel}.`
        );
        return;
      }

      formData.set("quantity", String(diff));
      formData.set("direction", "subtract");
      formData.set("category", "LOSS");
    }

    setQuantityError(null);
    void fetcher.submit(formData, {
      method: "POST",
      action: "/api/assets/adjust-quantity",
    });
  }

  const hasTotal = totalQuantity !== undefined && totalQuantity !== null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Adjust Quantity</AlertDialogTitle>
          <AlertDialogDescription>
            {hasTotal && activeTab === "total"
              ? "Set the new total stock for this asset."
              : `Add or remove stock for this asset. Enter the number of ${unitLabel} to adjust.`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form
          ref={formRef}
          method="POST"
          action="/api/assets/adjust-quantity"
        >
          <input type="hidden" name="assetId" value={assetId} />

          {hasTotal ? (
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "adjust" | "total")}
              className="w-full"
            >
              <TabsList className="mb-4 grid w-full grid-cols-2">
                <TabsTrigger value="adjust">Adjust by amount</TabsTrigger>
                <TabsTrigger value="total">Set new total</TabsTrigger>
              </TabsList>

              <TabsContent value="adjust" className="flex flex-col gap-4">
                <Input
                  ref={quantityInputRef}
                  name="quantity"
                  type="number"
                  label={`Quantity (${unitLabel})`}
                  placeholder="Enter quantity"
                  min={1}
                  step={1}
                  required={activeTab === "adjust"}
                  error={quantityError || serverError || undefined}
                  onChange={() => setQuantityError(null)}
                />
              </TabsContent>

              <TabsContent value="total" className="flex flex-col gap-4">
                <div className="mb-1 text-sm text-gray-500">
                  Current total:{" "}
                  <span className="font-semibold text-gray-900">
                    {totalQuantity} {unitLabel}
                  </span>
                </div>
                <Input
                  name="newTotal"
                  type="number"
                  label={`New Total Quantity (${unitLabel})`}
                  placeholder="Enter new total quantity"
                  min={0}
                  step={1}
                  required={activeTab === "total"}
                  error={quantityError || serverError || undefined}
                  onChange={() => setQuantityError(null)}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="flex flex-col gap-4">
              <Input
                ref={quantityInputRef}
                name="quantity"
                type="number"
                label={`Quantity (${unitLabel})`}
                placeholder="Enter quantity"
                min={1}
                step={1}
                required
                data-dialog-initial-focus
                error={quantityError || serverError || undefined}
                onChange={() => setQuantityError(null)}
              />
            </div>
          )}

          <div className="mt-4">
            <Input
              name="note"
              inputType="textarea"
              label="Note (optional)"
              placeholder="Reason for adjustment..."
              rows={3}
            />
          </div>
        </fetcher.Form>

        <AlertDialogFooter className="mt-4">
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary" disabled={isSubmitting}>
              Cancel
            </Button>
          </AlertDialogCancel>

          {hasTotal && activeTab === "total" ? (
            <Button
              type="button"
              variant="primary"
              onClick={handleSetTotal}
              disabled={disabled}
            >
              {isSubmitting ? "Saving..." : "Set Total"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => handleSubmit("subtract")}
                disabled={disabled}
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
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
