/**
 * Adjust Model Reservation Dialog
 *
 * Changes how many units of one `AssetModel` a booking reserves. Submits to
 * `/api/bookings/:bookingId/model-requests` via a fetcher, the same endpoint
 * the Models tab's inline editor posts to.
 *
 * The reason this exists beside that tab is timing: the moment an operator
 * learns a reserved unit is damaged, lost, or was never collected is usually
 * while the booking is out, standing at the shelf — and the reservation keeps
 * holding those units against every overlapping booking until it comes down.
 * So the control belongs on the reservation row itself, wherever it is shown.
 *
 * Floor: units already assigned to the booking cannot be reserved away, so the
 * lowest the quantity can go is `fulfilledQuantity`. Setting exactly that
 * releases everything still unassigned and closes the reservation out.
 *
 * No ceiling is offered here. This surface carries no per-model availability
 * (the booking overview does not load it), and a guessed cap is worse than
 * none: the server owns the pool and answers with the real headroom, which is
 * surfaced inline.
 *
 * @see {@link file://./model-request-row-actions-dropdown.tsx} — the row menu
 * @see {@link file://./adjust-booking-asset-quantity-dialog.tsx} — sibling for
 *   concrete quantity-tracked assets
 * @see {@link file://../../routes/api+/bookings.$bookingId.model-requests.ts}
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
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { isFormProcessing } from "~/utils/form";

/** Props for {@link AdjustModelReservationDialog}. */
export interface AdjustModelReservationDialogProps {
  /** The booking being edited — builds the API endpoint URL. */
  bookingId: string;
  /** The reserved model. */
  assetModelId: string;
  /** The model's name, shown for context. */
  modelName: string;
  /** Units currently reserved (pre-fills the input). */
  quantity: number;
  /** Units already assigned to a concrete asset — the floor. */
  fulfilledQuantity: number;
  /** Trigger element. Omit when driving the dialog with `open`. */
  trigger?: ReactNode;
  /** Controlled open state. */
  open?: boolean;
  /** Controlled open-change callback. */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Dialog for changing a booking's reserved quantity of one asset model.
 *
 * @param props - See {@link AdjustModelReservationDialogProps}.
 * @returns The dialog, wrapped around `trigger` when one is supplied.
 */
export function AdjustModelReservationDialog({
  bookingId,
  assetModelId,
  modelName,
  quantity,
  fulfilledQuantity,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AdjustModelReservationDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (isControlled) {
        controlledOnOpenChange?.(next);
      } else {
        setInternalOpen(next);
      }
    },
    [isControlled, controlledOnOpenChange]
  );

  const fetcher = useFetcher({
    key: `booking-model-request-update-${assetModelId}`,
  });
  const disabled = useDisabled(fetcher);
  const isSubmitting = isFormProcessing(fetcher.state);
  // Replaces `autoFocus` (jsx-a11y/no-autofocus) while keeping the intentional
  // modal-open focus. The hook defers past the Radix portal mount and
  // re-focuses on every closed → open flip.
  const quantityInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  /**
   * The lowest quantity the server will accept. A reservation always holds at
   * least one unit, so a request nothing has been assigned to floors at 1 —
   * releasing that one is a cancellation, which the row's Remove item does.
   */
  const floor = Math.max(1, fulfilledQuantity);
  const unassigned = Math.max(0, quantity - fulfilledQuantity);
  /**
   * Offered only once something has been assigned. With nothing assigned the
   * whole reservation is unassigned, and releasing all of it means removing
   * the row rather than reducing it.
   */
  const canReleaseUnassigned = fulfilledQuantity > 0 && unassigned > 0;

  const [value, setValue] = useState(String(quantity));
  const [clientError, setClientError] = useState<string | null>(null);
  /**
   * The last refusal this dialog actually received.
   *
   * Held in state rather than read off `fetcher.data`, because a keyed fetcher
   * hands back its final result for as long as it stays mounted: reading it
   * directly would re-show a refusal the operator already dealt with the next
   * time they open the dialog.
   */
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Each opening starts from what the booking reserves now, not from whatever
  // was typed and abandoned last time — including after a rejected submit.
  useEffect(() => {
    if (open) {
      setValue(String(quantity));
      setClientError(null);
      setSubmitError(null);
    }
  }, [open, quantity]);

  /**
   * Acts on the moment a submission FINISHES, never on the result sitting in
   * the fetcher.
   *
   * The same keyed-fetcher persistence applies to closing: a dialog that
   * closed on "there is a successful result" would slam shut the instant it
   * reopened, because the successful result from last time is still there.
   * Only the busy → idle edge means "the server has just answered me".
   */
  const wasBusyRef = useRef(false);
  useEffect(() => {
    const busy = fetcher.state !== "idle";

    if (wasBusyRef.current && !busy) {
      // A non-null VALUE, never `"error" in data`: the route's `payload()`
      // helper stamps `error: null` onto every success, so the key is always
      // present and its presence says nothing.
      const rejection = fetcher.data?.error as { message?: string } | null;

      if (rejection != null) {
        setSubmitError(
          rejection.message ?? "Couldn't save the reservation. Try again."
        );
      } else {
        // Revalidation brings the new quantity back to the row underneath.
        setSubmitError(null);
        setOpen(false);
      }
    }

    wasBusyRef.current = busy;
  }, [fetcher.state, fetcher.data, setOpen]);

  function handleSubmit() {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) {
      setClientError("Enter a whole number of units, at least 1.");
      return;
    }

    if (parsed < floor) {
      setClientError(
        `${fulfilledQuantity} ${
          fulfilledQuantity === 1 ? "unit is" : "units are"
        } already assigned to this booking, so ${floor} is the lowest this can go.`
      );
      return;
    }

    setClientError(null);
    setSubmitError(null);
    void fetcher.submit(
      { assetModelId, quantity: String(parsed) },
      {
        method: "POST",
        action: `/api/bookings/${bookingId}/model-requests`,
      }
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Adjust reservation</AlertDialogTitle>
          <AlertDialogDescription>
            Set how many units of "{modelName}" this booking reserves. Units you
            release go back to the pool for other bookings in this window.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Submission always runs through `handleSubmit`, so pressing Enter
            in the field is checked against the floor exactly like the Save
            button rather than posting the raw form. */}
        <fetcher.Form
          method="POST"
          action={`/api/bookings/${bookingId}/model-requests`}
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          <input type="hidden" name="assetModelId" value={assetModelId} />

          <div className="flex flex-col gap-4">
            <Input
              ref={quantityInputRef}
              name="quantity"
              type="number"
              label="Reserved units"
              min={floor}
              step={1}
              required
              value={value}
              error={clientError || submitError || undefined}
              onChange={(event) => {
                setValue(event.currentTarget.value);
                setClientError(null);
              }}
            />

            <div className="-mt-2 flex flex-col gap-1">
              <p className="text-xs text-gray-500">
                {fulfilledQuantity} of {quantity}{" "}
                {quantity === 1 ? "unit" : "units"} assigned so far.
                {fulfilledQuantity > 0
                  ? ` This reservation can't go below ${fulfilledQuantity}.`
                  : null}
              </p>

              {canReleaseUnassigned ? (
                <Button
                  type="button"
                  variant="link"
                  className="justify-start text-xs font-medium"
                  onClick={() => {
                    setValue(String(fulfilledQuantity));
                    setClientError(null);
                  }}
                >
                  Release the {unassigned} {unassigned === 1 ? "unit" : "units"}{" "}
                  still unassigned
                </Button>
              ) : null}
            </div>
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
