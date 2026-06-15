/**
 * Move Units Dialog
 *
 * Canonical quantity-input dialog for the three split/merge flows on
 * quantity-tracked assets:
 *
 * - `axis="location"`       — move N units between two manual `AssetLocation`
 *                             rows of the same asset.
 * - `axis="kit"`            — move N units between two `AssetKit` rows of
 *                             the same asset. Cascades to kit-driven
 *                             `BookingAsset` slices server-side.
 * - `axis="place-unplaced"` — one-sided variant: place N units that are
 *                             currently unplaced at a destination location.
 *
 * Submits via `useFetcher` to a caller-supplied `actionUrl`. The caller picks
 * the endpoint (shared route action vs. dedicated sub-route is decided in
 * Wave 2 of the integration), so this component is endpoint-agnostic.
 *
 * Mirrors the established dialog patterns from
 * `quantity-custody-dialog.tsx` (controlled open + auto-close on success)
 * and `adjust-booking-asset-quantity-dialog.tsx` (`useAutoFocus`, zod
 * validation, server-error fallback).
 *
 * @see {@link file://../../modules/asset/move-units.types.ts} - Shared contract
 * @see {@link file://./quantity-custody-dialog.tsx} - Pattern reference
 * @see {@link file://../booking/adjust-booking-asset-quantity-dialog.tsx} - Pattern reference
 */

import type { KeyboardEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { useActionData, useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import { z } from "zod";
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
import type { MoveAxis } from "~/modules/asset/move-units.types";
import { MOVE_UNITS_INTENT_FIELD } from "~/modules/asset/move-units.types";
import { isFormProcessing } from "~/utils/form";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";

/** A pickable destination — a location or a kit (caller decides which). */
export interface MoveUnitsDestination {
  /** Destination row id (location id or kit id, depending on `axis`). */
  id: string;
  /** Display name shown in the picker. */
  name: string;
}

/** Props for the {@link MoveUnitsDialog} component. */
export interface MoveUnitsDialogProps {
  /** Which axis the move acts on (`location`, `kit`, or `place-unplaced`). */
  axis: MoveAxis;
  /** Asset id whose units are being moved/placed. */
  assetId: string;
  /** Asset title — shown in the dialog description for context. */
  assetTitle: string;
  /** Optional unit-of-measure label (e.g., "pcs", "liters"). Falls back to "units". */
  unitOfMeasure?: string | null;

  /** For `axis="location"`: current location id + name + qty at the source row. */
  fromLocation?: { id: string; name: string; quantity: number };
  /** For `axis="kit"`: current kit id + name + qty at the source row. */
  fromKit?: { id: string; name: string; quantity: number };
  /** For `axis="place-unplaced"`: how many units are currently unplaced. */
  unplacedQuantity?: number;

  /**
   * Destinations the user can pick. The caller is expected to pre-filter so
   * the source row (if any) is excluded.
   */
  destinations: MoveUnitsDestination[];

  /** Optional render trigger element. Omit when using controlled mode. */
  trigger?: ReactNode;
  /** Controlled-mode open state. When provided, the dialog is externally controlled. */
  open?: boolean;
  /** Controlled-mode open-change callback. */
  onOpenChange?: (open: boolean) => void;

  /**
   * Form action URL. Caller picks the endpoint (e.g., shared action on
   * `assets.$assetId.overview.tsx` or a dedicated sub-route).
   */
  actionUrl: string;
}

/**
 * Resolve the source row's quantity (the maximum the user can move). For
 * `place-unplaced` this is `unplacedQuantity`; for the other axes it's the
 * source row's `quantity`. Returns `0` if no source info is supplied so the
 * client-side max guard fails closed.
 *
 * @param axis - Which axis the move acts on
 * @param fromLocation - Source location row (axis === "location")
 * @param fromKit - Source kit row (axis === "kit")
 * @param unplacedQuantity - Currently unplaced units (axis === "place-unplaced")
 */
function resolveMaxQuantity({
  axis,
  fromLocation,
  fromKit,
  unplacedQuantity,
}: Pick<
  MoveUnitsDialogProps,
  "axis" | "fromLocation" | "fromKit" | "unplacedQuantity"
>): number {
  switch (axis) {
    case "location":
      return fromLocation?.quantity ?? 0;
    case "kit":
      return fromKit?.quantity ?? 0;
    case "place-unplaced":
      return unplacedQuantity ?? 0;
  }
}

/**
 * Resolve copy used in the dialog header/description/picker depending on the
 * axis. Keeping all axis-specific strings in one place avoids inline ternaries
 * scattered across the JSX.
 */
function resolveCopy({
  axis,
  fromLocation,
  fromKit,
  unplacedQuantity,
  unitLabel,
}: Pick<
  MoveUnitsDialogProps,
  "axis" | "fromLocation" | "fromKit" | "unplacedQuantity"
> & {
  unitLabel: string;
}) {
  switch (axis) {
    case "location":
      return {
        title: `Move ${unitLabel} from ${fromLocation?.name ?? ""}`.trim(),
        description: `Move units between manual location rows. Up to ${
          fromLocation?.quantity ?? 0
        } ${unitLabel} available at the source.`,
        destinationLabel: "Destination location",
        destinationPlaceholder: "Select a location",
        submitIdle: "Move",
        submitBusy: "Moving...",
      };
    case "kit":
      return {
        title: `Move ${unitLabel} from ${fromKit?.name ?? ""}`.trim(),
        description: `Move units between kit allocations. Up to ${
          fromKit?.quantity ?? 0
        } ${unitLabel} available at the source kit.`,
        destinationLabel: "Destination kit",
        destinationPlaceholder: "Select a kit",
        submitIdle: "Move",
        submitBusy: "Moving...",
      };
    case "place-unplaced":
      return {
        title: `Place ${unplacedQuantity ?? 0} unplaced ${unitLabel}`,
        description: `Place currently-unplaced units at a destination location. Up to ${
          unplacedQuantity ?? 0
        } ${unitLabel} available.`,
        destinationLabel: "Destination location",
        destinationPlaceholder: "Select a location",
        submitIdle: "Place",
        submitBusy: "Placing...",
      };
  }
}

/**
 * Dialog for moving quantity-tracked units between two pivot rows (or
 * placing currently-unplaced units at a destination).
 *
 * Supports controlled and uncontrolled open modes (mirrors
 * `QuantityCustodyDialog`). Form submission goes through `useFetcher` to the
 * `actionUrl` prop. Auto-closes + resets on `fetcher.data.success`.
 *
 * @param props - See {@link MoveUnitsDialogProps}.
 * @returns AlertDialog with a destination picker + quantity input.
 */
export function MoveUnitsDialog({
  axis,
  assetId,
  assetTitle,
  unitOfMeasure,
  fromLocation,
  fromKit,
  unplacedQuantity,
  destinations,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  actionUrl,
}: MoveUnitsDialogProps) {
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

  /** The currently-selected destination id (drives the hidden `toId` input). */
  const [selectedDestinationId, setSelectedDestinationId] = useState<
    string | null
  >(null);
  /** Whether the destination picker popover is open. */
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * Index of the keyboard-highlighted destination row inside the open
   * popover — drives the `↑ ↓ Enter` keyboard pattern shared with
   * `field-selector.tsx`. Reset to 0 every time the popover (re-)opens.
   */
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const pickerTriggerRef = useRef<HTMLButtonElement>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: unknown }>({
    key: `move-units-${axis}-${assetId}`,
  });
  const disabled = useDisabled(fetcher);
  const isSubmitting = isFormProcessing(fetcher.state);
  const formRef = useRef<HTMLFormElement>(null);

  const unitLabel = unitOfMeasure || "units";
  const maxQuantity = resolveMaxQuantity({
    axis,
    fromLocation,
    fromKit,
    unplacedQuantity,
  });
  const copy = resolveCopy({
    axis,
    fromLocation,
    fromKit,
    unplacedQuantity,
    unitLabel,
  });

  /**
   * Zod schema for client-side validation. Memoised so the upper bound
   * recomputes only when `maxQuantity` changes — Zorm doesn't re-validate
   * on identical schema refs, so this also prevents stale `max` errors.
   */
  const moveUnitsClientSchema = useMemo(
    () =>
      z.object({
        [MOVE_UNITS_INTENT_FIELD]: z.enum([
          "location",
          "kit",
          "place-unplaced",
        ]),
        toId: z.string().cuid("Please pick a destination."),
        quantity: z.coerce
          .number()
          .int("Quantity must be a whole number.")
          .positive("Quantity must be greater than zero.")
          .max(maxQuantity, `Maximum ${maxQuantity} ${unitLabel} available.`),
      }),
    [maxQuantity, unitLabel]
  );

  const zo = useZorm("MoveUnits", moveUnitsClientSchema);

  /**
   * Server-side validation errors fallback per CLAUDE.md "Form Validation
   * Pattern (Required)" rule. The action may pass `validationErrors` through
   * `additionalData`; the zo client check is the first line, this is the
   * safety net.
   */
  const actionData = useActionData<DataOrErrorResponse>();
  const validationErrors = getValidationErrors<typeof moveUnitsClientSchema>(
    actionData?.error
  );

  /**
   * Top-level error message from the fetcher response (e.g., "Quantity
   * exceeds available"). Shown above the form so it's not duplicated per
   * field when the server returns a plain error.
   */
  const serverErrorMessage =
    fetcher.data?.error != null
      ? (fetcher.data.error as { message?: string })?.message
      : null;

  /**
   * Imperatively focus the quantity input on open. Per the
   * `use-auto-focus-hook` rule: don't hand-roll `useRef + useEffect`; the
   * shared hook handles the rAF defer that Radix portals need.
   */
  const quantityInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  /** Stable id used to wire `aria-describedby` between the qty input and helper. */
  const quantityHelperId = `move-units-qty-help-${axis}-${assetId}`;

  /** Close the dialog + reset state once the fetcher reports success. */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setOpen(false);
      setSelectedDestinationId(null);
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data, setOpen]);

  /**
   * Empty-destinations guard. Shown in place of the picker so the user
   * understands why submit is unavailable, instead of seeing an empty
   * Select that looks broken.
   */
  const noDestinations = destinations.length === 0;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.description}
            {assetTitle ? ` Asset: "${assetTitle}".` : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverErrorMessage ? (
          // Mirrors the shape of `WarningBox` (text-sm + p-4 + 25/300/700 token
          // ladder) so server-side block errors render with the same weight as
          // the inline warnings used elsewhere in the app — just in error tone.
          <div
            role="alert"
            className="rounded border border-error-300 bg-error-25 p-4 text-sm text-error-700"
          >
            {serverErrorMessage}
          </div>
        ) : null}

        <fetcher.Form
          ref={(node) => {
            // why: react-zorm exposes a ref function and we also keep our own
            // formRef for `.reset()` on success. Forward both.
            zo.ref(node);
            formRef.current = node;
          }}
          method="POST"
          action={actionUrl}
        >
          {/* Intent + identity fields */}
          <input type="hidden" name={MOVE_UNITS_INTENT_FIELD} value={axis} />
          <input type="hidden" name="assetId" value={assetId} />
          {fromLocation ? (
            <input
              type="hidden"
              name="fromLocationId"
              value={fromLocation.id}
            />
          ) : null}
          {fromKit ? (
            <input type="hidden" name="fromKitId" value={fromKit.id} />
          ) : null}
          {/* Hidden mirror of the picker so the server gets `toId` regardless
              of whether the Radix Select component submits it natively. */}
          <input
            type="hidden"
            name="toId"
            value={selectedDestinationId ?? ""}
          />

          <div className="flex flex-col gap-4">
            {/* Destination picker — Popover + click-list pattern (per CLAUDE.md
                "Deprecated Components" guidance and the canonical
                field-selector.tsx implementation). The native `<Select>` was
                replaced because its disconnected dropdown chrome didn't match
                the rest of the app's secondary-button + Popover idiom. */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor={`move-units-destination-${axis}-${assetId}`}
                className="text-sm font-medium text-gray-700"
              >
                {copy.destinationLabel}
              </label>
              {(() => {
                const selectedDestination = selectedDestinationId
                  ? destinations.find((d) => d.id === selectedDestinationId) ??
                    null
                  : null;
                const triggerError = Boolean(
                  validationErrors?.toId?.message || zo.errors.toId()?.message
                );
                const triggerDisabled = disabled || noDestinations;

                const handleKeyDown = (
                  event: KeyboardEvent<HTMLDivElement>
                ) => {
                  switch (event.key) {
                    case "ArrowDown":
                      event.preventDefault();
                      setHighlightedIndex((prev) =>
                        Math.min(prev + 1, destinations.length - 1)
                      );
                      break;
                    case "ArrowUp":
                      event.preventDefault();
                      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
                      break;
                    case "Enter":
                      event.preventDefault();
                      {
                        const candidate = destinations[highlightedIndex];
                        if (candidate) {
                          setSelectedDestinationId(candidate.id);
                          setPickerOpen(false);
                          pickerTriggerRef.current?.focus();
                        }
                      }
                      break;
                  }
                };

                return (
                  <Popover
                    open={pickerOpen}
                    onOpenChange={(next) => {
                      if (triggerDisabled && next) return;
                      setPickerOpen(next);
                      if (next) {
                        // Highlight the current selection (or the first row)
                        // on each open so the keyboard cursor starts somewhere
                        // sensible.
                        const idx = selectedDestinationId
                          ? destinations.findIndex(
                              (d) => d.id === selectedDestinationId
                            )
                          : 0;
                        setHighlightedIndex(idx >= 0 ? idx : 0);
                      }
                    }}
                  >
                    {/* Trigger shape mirrors DynamicSelect's canonical pattern:
                        a button-wrapper around an inner styled <div> carrying
                        the border/padding/chevron. Using the inner-div idiom
                        (not the shared Button component) is intentional — see
                        components/dynamic-select/dynamic-select.tsx. */}
                    <PopoverTrigger asChild disabled={triggerDisabled}>
                      <button
                        ref={pickerTriggerRef}
                        type="button"
                        id={`move-units-destination-${axis}-${assetId}`}
                        aria-label={copy.destinationLabel}
                        aria-haspopup="listbox"
                        aria-expanded={pickerOpen}
                        disabled={triggerDisabled}
                        className={tw(
                          "w-full",
                          triggerDisabled && "cursor-not-allowed opacity-60"
                        )}
                      >
                        <div
                          className={tw(
                            "flex w-full items-center justify-between whitespace-nowrap rounded border border-gray-300 px-[14px] py-2 text-sm hover:cursor-pointer",
                            triggerError && "border-error-300"
                          )}
                        >
                          <span
                            className={tw(
                              "truncate whitespace-nowrap pr-2",
                              !selectedDestination && "text-gray-500"
                            )}
                          >
                            {selectedDestination
                              ? selectedDestination.name
                              : noDestinations
                              ? "No destinations available"
                              : copy.destinationPlaceholder}
                          </span>
                          <ChevronDownIcon className="text-gray-500" />
                        </div>
                      </button>
                    </PopoverTrigger>
                    <PopoverPortal>
                      <PopoverContent
                        align="start"
                        sideOffset={4}
                        className={tw(
                          "z-[999999] max-h-[280px] w-[var(--radix-popover-trigger-width)] overflow-auto rounded-md border border-gray-200 bg-white shadow-md"
                        )}
                        onKeyDown={handleKeyDown}
                      >
                        <ul role="listbox" className="py-1">
                          {destinations.map((destination, index) => {
                            const isSelected =
                              destination.id === selectedDestinationId;
                            const isHighlighted = index === highlightedIndex;
                            return (
                              <li
                                key={destination.id}
                                role="option"
                                aria-selected={isSelected}
                                tabIndex={0}
                                className={tw(
                                  "cursor-pointer px-4 py-2 text-sm text-gray-700 hover:bg-gray-50",
                                  isHighlighted && "bg-gray-50",
                                  isSelected && "font-medium"
                                )}
                                onClick={() => {
                                  setSelectedDestinationId(destination.id);
                                  setPickerOpen(false);
                                  pickerTriggerRef.current?.focus();
                                }}
                                onMouseEnter={() => setHighlightedIndex(index)}
                                onKeyDown={handleActivationKeyPress(() => {
                                  setSelectedDestinationId(destination.id);
                                  setPickerOpen(false);
                                  pickerTriggerRef.current?.focus();
                                })}
                              >
                                {destination.name}
                              </li>
                            );
                          })}
                        </ul>
                      </PopoverContent>
                    </PopoverPortal>
                  </Popover>
                );
              })()}
              {validationErrors?.toId?.message || zo.errors.toId()?.message ? (
                <p className="text-xs text-error-500">
                  {validationErrors?.toId?.message || zo.errors.toId()?.message}
                </p>
              ) : null}
            </div>

            {/* Quantity input */}
            <div className="flex flex-col gap-1">
              <Input
                ref={quantityInputRef}
                name={zo.fields.quantity()}
                type="number"
                label={`Quantity (${unitLabel})`}
                placeholder={`Max: ${maxQuantity}`}
                min={1}
                max={maxQuantity || undefined}
                step={1}
                required
                aria-describedby={quantityHelperId}
                error={
                  validationErrors?.quantity?.message ||
                  zo.errors.quantity()?.message
                }
              />
              <p id={quantityHelperId} className="text-xs text-gray-500">
                Max: {maxQuantity} {unitLabel}
              </p>
            </div>
          </div>

          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={isSubmitting}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Button
              type="submit"
              variant="primary"
              disabled={disabled || noDestinations}
            >
              {isSubmitting ? copy.submitBusy : copy.submitIdle}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
