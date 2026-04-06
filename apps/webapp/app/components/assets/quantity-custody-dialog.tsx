/**
 * Quantity Custody Dialog
 *
 * A dialog component for assigning a specific quantity of a QUANTITY_TRACKED
 * asset to a team member. Uses a DynamicSelect for team member selection and
 * a quantity input, then submits to `/api/assets/assign-quantity-custody`.
 *
 * Designed to be triggered from the QuantityCustodyList card on the asset
 * detail overview page.
 *
 * @see {@link file://../../routes/api+/assets.assign-quantity-custody.ts} - API endpoint
 * @see {@link file://./quantity-custody-list.tsx} - Trigger location
 */

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
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
import { isFormProcessing } from "~/utils/form";
import { resolveTeamMemberName } from "~/utils/user";

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

  /** Close the dialog and reset state after a successful submission */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setOpen(false);
      setSelectedTeamMemberId(null);
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data, setOpen]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      ) : null}

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Assign Quantity Custody</AlertDialogTitle>
          <AlertDialogDescription>
            Assign a quantity of this asset to a team member. Select who
            receives custody and how many {unitLabel} to assign.
          </AlertDialogDescription>
        </AlertDialogHeader>

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
