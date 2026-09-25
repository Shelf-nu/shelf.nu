/**
 * Quantity Custody Dialog
 *
 * A dialog component for assigning a specific quantity of a QUANTITY_TRACKED
 * asset to a team member. Uses a DynamicSelect for team member selection and
 * a quantity input, then submits to `/api/assets/assign-quantity-custody`.
 *
 * Designed to be triggered from the QuantityCustodyList card on the asset
 * detail overview page and from the asset header's actions menu. Both pass
 * the same `sources` summary from the asset detail loader.
 *
 * For a pool with two or more sources (locations, or a location plus
 * unplaced units) a "From location" field asks where the units come from,
 * pre-selected with the source that has the most units left. Every other
 * asset gets the dialog without it.
 *
 * @see {@link file://../../routes/api+/assets.assign-quantity-custody.ts} - API endpoint
 * @see {@link file://./quantity-custody-list.tsx} - Trigger location
 * @see {@link file://./custody-source-select.tsx} - The "From location" field
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
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
import type { CustodySourceSummary } from "~/modules/asset/custody-source";
import { defaultSourceOption } from "~/modules/asset/custody-source";
import { isFormProcessing } from "~/utils/form";
import { resolveTeamMemberName } from "~/utils/user";
import { CustodySourceSelect } from "./custody-source-select";

/** Props for the QuantityCustodyDialog component */
export interface QuantityCustodyDialogProps {
  /** The ID of the asset to assign custody for */
  assetId: string;
  /** The trigger element that opens the dialog. Omit when using controlled mode. */
  trigger?: ReactNode;
  /** Optional unit of measure label (e.g., "pcs", "liters") */
  unitOfMeasure?: string | null;
  /** Maximum quantity available for checkout */
  availableQuantity?: number;
  /** Controlled open state — when provided, the dialog is externally controlled */
  open?: boolean;
  /** Callback when the dialog open state changes (controlled mode) */
  onOpenChange?: (open: boolean) => void;
  /** When the asset is part of a kit (whether or not the kit is in
   * custody), surface an informational note so the user understands the
   * operator assignment they're about to make is tracked separately from
   * the kit's allocation. */
  inKit?: { id: string; name: string } | null;
  /**
   * The pool's sources, from the asset detail loader. The "From location"
   * field renders only when `multiSource` is true.
   */
  sources?: CustodySourceSummary | null;
}

/**
 * Dialog for assigning quantity custody of a QUANTITY_TRACKED asset
 * to a team member.
 *
 * Supports two modes:
 * - **Uncontrolled** (default): Pass a `trigger` element. The dialog manages
 *   its own open/close state via `AlertDialogTrigger`.
 * - **Controlled**: Pass `open` and `onOpenChange` props. Useful when the
 *   dialog must render outside a parent popover to avoid portal conflicts.
 *
 * Uses a fetcher to POST to `/api/assets/assign-quantity-custody`.
 * The dialog auto-closes on successful submission and resets its form fields.
 *
 * @param props - Dialog configuration
 * @returns AlertDialog component with team member selection and quantity input
 */
export function QuantityCustodyDialog({
  assetId,
  trigger,
  unitOfMeasure,
  availableQuantity,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  inKit,
  sources,
}: QuantityCustodyDialogProps) {
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
  /** Track the selected team member ID for the hidden input */
  const [selectedTeamMemberId, setSelectedTeamMemberId] = useState<
    string | null
  >(null);
  const fetcher = useFetcher({ key: "assign-quantity-custody" });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);

  const unitLabel = unitOfMeasure || "units";
  const isSubmitting = isFormProcessing(fetcher.state);

  /**
   * The "From location" choice. Held as the operator's pick; until they
   * pick (or when their pick no longer exists after a revalidation) the
   * field shows the source with the most units left.
   */
  const sourceOptions = sources?.multiSource ? sources.options : [];
  const showSource = sourceOptions.length > 0;
  const [pickedSource, setPickedSource] = useState<string | null>(null);
  const sourceValue =
    pickedSource !== null &&
    sourceOptions.some((option) => option.value === pickedSource)
      ? pickedSource
      : defaultSourceOption(sourceOptions)?.value ?? "";

  /**
   * Server-side refusal, shown above the form: the source may have fewer
   * units left than asked for, or custody moved while the dialog was open.
   */
  const serverErrorMessage =
    fetcher.data?.error != null
      ? (fetcher.data.error as { message?: string })?.message
      : null;

  /** Close the dialog and reset state after a successful submission */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setOpen(false);
      setSelectedTeamMemberId(null);
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data, setOpen]);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // Each open starts from the pre-selected source. The header menu
        // mounts this dialog only while open, which resets it the same way.
        if (next) setPickedSource(null);
        setOpen(next);
      }}
    >
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Assign Quantity Custody</AlertDialogTitle>
          <AlertDialogDescription>
            {showSource ? (
              <>
                Assign a quantity of this asset to a team member. Select who
                receives custody, where the units come from, and how many{" "}
                {unitLabel} to assign.
              </>
            ) : (
              <>
                Assign a quantity of this asset to a team member. Select who
                receives custody and how many {unitLabel} to assign.
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

        {inKit ? (
          <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p>
              This asset is part of kit{" "}
              <Link to={`/kits/${inKit.id}`} className="font-medium underline">
                {inKit.name}
              </Link>
              . Operator custody you assign here is tracked separately from the
              kit's allocation — the kit's "in kit" count is unaffected.
            </p>
          </div>
        ) : null}

        <fetcher.Form
          ref={formRef}
          method="POST"
          action="/api/assets/assign-quantity-custody"
        >
          <input type="hidden" name="assetId" value={assetId} />
          <input
            type="hidden"
            name="teamMemberId"
            value={selectedTeamMemberId ?? ""}
          />

          <div className="flex flex-col gap-4">
            {/* Team member selector */}
            <div className="relative z-50">
              <DynamicSelect
                disabled={disabled}
                model={{
                  name: "teamMember",
                  queryKey: "name",
                  deletedAt: null,
                  // ASSET custody: SELF_SERVICE may only take custody itself
                  // and BASE never.
                  custodyPurpose: "custody-assignment",
                }}
                fieldName="teamMemberSelect"
                contentLabel="Team members"
                initialDataKey="teamMembers"
                countKey="totalTeamMembers"
                placeholder="Select a team member"
                allowClear
                closeOnSelect
                transformItem={(item) => ({
                  ...item,
                  id: item.id,
                })}
                renderItem={(item) => resolveTeamMemberName(item, true)}
                onChange={(value) => {
                  /** Extract the team member ID from the selection */
                  setSelectedTeamMemberId(value ?? null);
                }}
              />
            </div>

            {showSource ? (
              <CustodySourceSelect
                id={`assign-custody-source-${assetId}`}
                label="From location"
                options={sourceOptions}
                value={sourceValue}
                onChange={setPickedSource}
                unitLabel={unitLabel}
                disabled={disabled}
              />
            ) : null}

            <Input
              name="quantity"
              type="number"
              label={`Quantity (${unitLabel})`}
              placeholder={
                availableQuantity != null
                  ? `Max: ${availableQuantity}`
                  : "Enter quantity"
              }
              min={1}
              max={availableQuantity ?? undefined}
              step={1}
              required
            />

            <Input
              name="note"
              inputType="textarea"
              label="Note (optional)"
              placeholder="Reason for assignment..."
              rows={2}
            />
          </div>

          <AlertDialogFooter className="mt-4 gap-2">
            <AlertDialogCancel asChild>
              <Button type="button" variant="secondary" disabled={isSubmitting}>
                Cancel
              </Button>
            </AlertDialogCancel>

            <Button type="submit" variant="primary" disabled={disabled}>
              {isSubmitting ? "Assigning..." : "Assign"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
