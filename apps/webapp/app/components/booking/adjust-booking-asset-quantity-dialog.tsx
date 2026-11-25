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
 * With `sourceEditor`, the dialog also shows a "From" section to choose
 * where the slice's units come from. A split the operator edited is sent as
 * a MANUAL `sources` field with the quantity; "Auto" sends `{ mode: "AUTO" }`
 * at once. An untouched split sends no `sources` field, so a plain quantity
 * change leaves the sources to the server's resize.
 *
 * @see {@link file://../../routes/api+/bookings.$bookingId.adjust-asset-quantity.ts}
 * @see {@link file://./booking-source-editor.tsx}
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import {
  BookingSourceEditor,
  useSourceSplit,
} from "~/components/booking/booking-source-editor";
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
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import { useRoleAccess } from "~/hooks/use-role-access";
import {
  isSplitLocked,
  requiredPending,
  resolveManualSources,
  type SourceEditorData,
} from "~/modules/booking/sources/source-editor";
import type { AdjustBookingAssetQuantitySchema } from "~/routes/api+/bookings.$bookingId.adjust-asset-quantity";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";

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
  /**
   * The slice's "From" section data (from the adjust route's loader). Null
   * or omitted hides the section: only standalone pool slices of pools with
   * manual placements, on bookings the viewer may change, get one.
   */
  sourceEditor?: SourceEditorData | null;
}

/** One opening's form state: what is typed and what was last sent. */
type FormState = {
  /** Client-side complaint about the quantity, if any. */
  quantityError: string | null;
  /** The quantity being typed, so the From section knows its target. */
  quantityDraft: string;
  /** Whether this opening's last submission carried a `sources` field. */
  sentSources: boolean;
};

type FormAction =
  | { type: "open"; currentQuantity: number }
  | { type: "type"; value: string }
  | { type: "quantityError"; message: string | null }
  | { type: "submitted"; sentSources: boolean };

function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "open":
      return {
        quantityError: null,
        quantityDraft: String(action.currentQuantity),
        sentSources: false,
      };
    case "type":
      return { ...state, quantityError: null, quantityDraft: action.value };
    case "quantityError":
      return { ...state, quantityError: action.message };
    case "submitted":
      return { ...state, quantityError: null, sentSources: action.sentSources };
  }
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
  sourceEditor,
}: AdjustBookingAssetQuantityDialogProps) {
  // The link opens the bookings index; offer it exactly when that index would
  // show this member other people's bookings.
  const canViewOtherBookings = useRoleAccess().bookings.seeAll;
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

  const [form, dispatch] = useReducer(formReducer, {
    quantityError: null,
    quantityDraft: String(currentQuantity),
    sentSources: false,
  });
  const { quantityError, quantityDraft, sentSources } = form;
  const split = useSourceSplit(sourceEditor);
  const fetcher = useFetcher<DataOrErrorResponse>({
    key: `adjust-booking-asset-${assetId}`,
  });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);
  // Replaces `autoFocus` to satisfy jsx-a11y/no-autofocus while keeping the
  // intentional modal-open focus UX. The hook handles the rAF-defer needed
  // for the Radix portal mount and re-focuses on every closed → open flip.
  const quantityInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  const unitLabel = unitOfMeasure || "units";
  const isSubmitting = isFormProcessing(fetcher.state);

  /**
   * What the server has said during THIS opening. The fetcher is keyed, so it
   * keeps handing back its last response after the dialog closes: read
   * directly, an old refusal reappears and an old success closes the dialog
   * the moment it opens.
   */
  const outcome = useFetcherOutcomeSinceOpen(fetcher, open);
  const serverError = outcome.message;
  /** Field errors of this opening's refusal (server-side Zod fallback). */
  const validationErrors =
    outcome.status === "rejected"
      ? getValidationErrors<typeof AdjustBookingAssetQuantitySchema>(
          fetcher.data?.error
        )
      : undefined;

  // The client-side complaint belongs to one opening too: the operator fixing
  // the number tomorrow should not be met with yesterday's objection to it.
  const resetSplit = split.reset;
  useEffect(() => {
    if (open) {
      dispatch({ type: "open", currentQuantity });
      resetSplit();
    }
  }, [open, currentQuantity, resetSplit]);

  /** New quantity minus the current one; 0 while the input is not a number. */
  const draftNumber = Number(quantityDraft);
  const quantityDelta = Number.isInteger(draftNumber)
    ? draftNumber - currentQuantity
    : 0;

  // A refusal of a request that carried sources is shown under From, where
  // the operator is looking; anything else stays on the quantity field.
  const sourcesServerError = sentSources
    ? validationErrors?.sources?.message || serverError
    : null;
  const quantityServerError =
    validationErrors?.quantity?.message || (sentSources ? null : serverError);

  /** Close once this opening's change has been accepted. */
  useEffect(() => {
    if (outcome.status === "accepted") {
      setOpen(false);
      dispatch({ type: "quantityError", message: null });
      formRef.current?.reset();
    }
  }, [outcome.status, setOpen]);

  /**
   * Submit with client-side validation.
   *
   * @param auto - True for the From section's Auto button: the sources go
   *   back to the allocation rule, whatever the split shows.
   */
  function handleSubmit(auto = false) {
    const form = formRef.current;
    if (!form) return;

    const formData = new FormData(form);
    const qty = Number(formData.get("quantity"));

    if (!Number.isInteger(qty) || qty < 1) {
      dispatch({
        type: "quantityError",
        message: "Quantity must be a whole number greater than 0.",
      });
      return;
    }

    // Block genuine attempts to go ABOVE the max, but never block a
    // reduction (or a no-op resubmit) below `currentQuantity` — an
    // already-over-committed row (currentQuantity > maxQuantity, e.g. the
    // window shrank after another booking grabbed units) must stay
    // editable-down. The server guard is the real source of truth; this is
    // purely a client-side UX nicety.
    if (maxQuantity != null && qty > maxQuantity && qty > currentQuantity) {
      dispatch({
        type: "quantityError",
        message: `Only ${maxQuantity} ${unitLabel} available. Please reduce the quantity.`,
      });
      return;
    }

    let hasSources = false;
    if (sourceEditor && auto) {
      formData.set("sources", JSON.stringify({ mode: "AUTO" }));
      hasSources = true;
    } else if (
      sourceEditor &&
      split.edited &&
      // A locked split offers only Auto; nothing typed is sent.
      !isSplitLocked(sourceEditor)
    ) {
      const resolved = resolveManualSources({
        editor: sourceEditor,
        values: split.values,
        quantityDelta: qty - currentQuantity,
        unitLabel,
      });
      if (!resolved.ok) {
        split.setError(resolved.message);
        return;
      }
      formData.set("sources", JSON.stringify(resolved.input));
      hasSources = true;
    }
    split.setError(null);
    dispatch({ type: "submitted", sentSources: hasSources });

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
              error={quantityError || quantityServerError || undefined}
              onChange={(event) =>
                dispatch({ type: "type", value: event.target.value })
              }
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
                        for <DateS date={windowFrom} /> to{" "}
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
            {sourceEditor ? (
              <BookingSourceEditor
                editor={sourceEditor}
                values={split.values}
                edited={split.edited}
                onChange={split.change}
                onAuto={() => handleSubmit(true)}
                required={requiredPending(sourceEditor, quantityDelta)}
                error={split.error || sourcesServerError}
                disabled={disabled}
                unitLabel={unitLabel}
              />
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
            onClick={() => handleSubmit()}
            disabled={disabled}
          >
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
