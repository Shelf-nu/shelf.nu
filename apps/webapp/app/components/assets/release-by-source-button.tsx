/**
 * Release By Source Button
 *
 * The Release / Mark as consumed dialog for a person who holds units of a
 * pool taken from two or more locations. Instead of one quantity it asks per
 * location ("From Camera Room: max 2", "From Studio: max 1"), and for a
 * consumable how many of each were used up, because used-up units come off
 * the location they were taken from.
 *
 * Posts to the same endpoint as the single-source dialog, with the lines as a
 * JSON `sources` field and their sum as `quantity`. The server re-checks every
 * line against the holder's rows under the asset lock.
 *
 * @see {@link file://./quantity-custody-list.tsx} - The breakdown that renders it
 * @see {@link file://../../routes/api+/assets.release-quantity-custody.ts} - Endpoint
 */

import { useEffect, useReducer, useRef, useState } from "react";
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
import { useFetcherErrorSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import { isFormProcessing } from "~/utils/form";
import type { GroupableCustodyRecord } from "./quantity-custody-groups";
import {
  releaseLineSource,
  releaseSourceValue,
} from "./quantity-custody-groups";

/**
 * One source line of the form. Snapshotted when the dialog opens, so a
 * revalidation that changes the person's rows cannot pair a line's posted
 * source with another row's label.
 */
type ReleaseLineState = {
  /** Posted source: a location id, `"unplaced"` or `"unrecorded"`. */
  source: string;
  /** "From Camera Room", "Unplaced" or "Location not recorded". */
  label: string;
  /** Units this person holds from that source. */
  max: number;
  /** Units leaving the hold from that source. */
  quantity: number;
  /** How many of those were used up (consumables only). */
  consumed: number;
};

/** Transitions for the per-line form. */
type ReleaseLinesAction =
  | { type: "reset"; rows: GroupableCustodyRecord[]; isConsumable: boolean }
  | { type: "set_quantity"; index: number; value: number }
  | { type: "set_consumed"; index: number; value: number };

/** A typed value as whole units: decimals are cut, anything unreadable is 0. */
function wholeUnits(value: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

/**
 * Keeps every line within its bounds: whole units, quantity between 0 and
 * what the person holds from that source, consumed between 0 and the line's
 * quantity.
 */
export function releaseLinesReducer(
  lines: ReleaseLineState[],
  action: ReleaseLinesAction
): ReleaseLineState[] {
  switch (action.type) {
    case "reset":
      // Opens on a full release, like the single-source dialog; a
      // consumable defaults to everything used up.
      return action.rows.map((row) => {
        const max = row.quantity ?? 1;
        return {
          source: releaseSourceValue(row),
          label: releaseLineSource(row),
          max,
          quantity: max,
          consumed: action.isConsumable ? max : 0,
        };
      });
    case "set_quantity":
      return lines.map((line, index) => {
        if (index !== action.index) return line;
        const quantity = Math.min(
          Math.max(wholeUnits(action.value), 0),
          line.max
        );
        return {
          ...line,
          quantity,
          consumed: Math.min(line.consumed, quantity),
        };
      });
    case "set_consumed":
      return lines.map((line, index) =>
        index === action.index
          ? {
              ...line,
              consumed: Math.min(
                Math.max(wholeUnits(action.value), 0),
                line.quantity
              ),
            }
          : line
      );
  }
}

/** Props for {@link ReleaseBySourceButton}. */
export type ReleaseBySourceButtonProps = {
  assetId: string;
  teamMemberId: string;
  /** Fetcher key, per custody row. */
  fetcherKey: string;
  /** The person's operator rows, one per source. */
  rows: GroupableCustodyRecord[];
  unitLabel: string;
  /** Consumables are marked as consumed per line. */
  isConsumable?: boolean;
};

/**
 * A button that opens the per-location release dialog.
 *
 * @param props - See {@link ReleaseBySourceButtonProps}
 */
export function ReleaseBySourceButton({
  assetId,
  teamMemberId,
  fetcherKey,
  rows,
  unitLabel,
  isConsumable = false,
}: ReleaseBySourceButtonProps) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher({ key: fetcherKey });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);
  const isSubmitting = isFormProcessing(fetcher.state);

  const [lines, dispatch] = useReducer(
    releaseLinesReducer,
    rows,
    (initialRows) =>
      releaseLinesReducer([], {
        type: "reset",
        rows: initialRows,
        isConsumable,
      })
  );

  /** Each open starts a fresh release from what the person holds now. */
  const handleOpenChange = (next: boolean) => {
    if (next) dispatch({ type: "reset", rows, isConsumable });
    setOpen(next);
  };

  /** Close after a successful release. */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setOpen(false);
    }
  }, [fetcher.state, fetcher.data]);

  /** A refusal from this opening only, never one left from an earlier try. */
  const serverErrorMessage = useFetcherErrorSinceOpen(fetcher, open);

  const total = lines.reduce((sum, line) => sum + line.quantity, 0);
  const consumedTotal = lines.reduce((sum, line) => sum + line.consumed, 0);
  const held = rows.reduce((sum, row) => sum + (row.quantity ?? 1), 0);
  const sourcesValue = JSON.stringify(
    lines
      .filter((line) => line.quantity > 0)
      .map((line) => ({
        locationId: line.source,
        quantity: line.quantity,
        ...(isConsumable ? { consumed: line.consumed } : {}),
      }))
  );

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="secondary" className="py-1 text-xs">
          {isConsumable ? "Mark as consumed" : "Release"}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isConsumable ? "Mark as consumed" : "Release Quantity"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isConsumable ? (
              <>
                These {unitLabel} came from more than one location. Choose how
                many leave this custodian's hold from each, and how many of
                those were used up. Used-up units come off the location they
                were taken from and cannot be restored. Maximum: {held}.
              </>
            ) : (
              <>
                These {unitLabel} came from more than one location. Enter how
                many to release from each. Maximum: {held}.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverErrorMessage ? (
          <div
            role="alert"
            className="rounded border border-error-300 bg-error-25 p-4 text-sm text-error-700"
          >
            {serverErrorMessage}
          </div>
        ) : null}

        <fetcher.Form
          ref={formRef}
          method="POST"
          action="/api/assets/release-quantity-custody"
        >
          <input type="hidden" name="assetId" value={assetId} />
          <input type="hidden" name="teamMemberId" value={teamMemberId} />
          <input type="hidden" name="quantity" value={total} />
          <input type="hidden" name="sources" value={sourcesValue} />

          <div className="flex flex-col gap-4">
            {lines.map((line, index) => {
              const setQuantity = (value: number) =>
                dispatch({ type: "set_quantity", index, value });

              // A returnable asks one number per location; a consumable asks
              // two, grouped under the location so the fields line up.
              return isConsumable ? (
                <fieldset key={line.source} className="flex flex-col gap-2">
                  <legend className="mb-1 text-sm font-medium text-gray-700">
                    {line.label}
                  </legend>
                  <div className="grid grid-cols-2 gap-3">
                    <Input
                      name={`sourceQuantity-${index}`}
                      type="number"
                      label={`Units, max ${line.max} ${unitLabel}`}
                      min={0}
                      max={line.max}
                      step={1}
                      value={line.quantity}
                      onChange={(event) =>
                        setQuantity(Number(event.target.value))
                      }
                    />
                    <Input
                      name={`sourceConsumed-${index}`}
                      type="number"
                      label="Of those, used up"
                      min={0}
                      max={line.quantity}
                      step={1}
                      value={line.consumed}
                      onChange={(event) =>
                        dispatch({
                          type: "set_consumed",
                          index,
                          value: Number(event.target.value),
                        })
                      }
                    />
                  </div>
                </fieldset>
              ) : (
                <Input
                  key={line.source}
                  name={`sourceQuantity-${index}`}
                  type="number"
                  label={`${line.label}: max ${line.max} ${unitLabel}`}
                  min={0}
                  max={line.max}
                  step={1}
                  value={line.quantity}
                  onChange={(event) => setQuantity(Number(event.target.value))}
                />
              );
            })}

            <p className="text-[12px] text-gray-500">
              {isConsumable
                ? `${consumedTotal} of ${total} ${unitLabel} will be removed from stock permanently${
                    total - consumedTotal > 0
                      ? `; the remaining ${
                          total - consumedTotal
                        } go back to where they came from`
                      : ""
                  }.`
                : `${total} ${unitLabel} go back to where they came from.`}
            </p>

            <Input
              name="note"
              inputType="textarea"
              label="Note (optional)"
              placeholder={
                isConsumable
                  ? "What were they used for..."
                  : "Reason for release..."
              }
              rows={2}
            />
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
              disabled={
                disabled
                  ? true
                  : total === 0
                  ? { reason: "Enter at least one unit." }
                  : false
              }
            >
              {isConsumable
                ? isSubmitting
                  ? "Marking..."
                  : "Mark as consumed"
                : isSubmitting
                ? "Releasing..."
                : "Release"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
