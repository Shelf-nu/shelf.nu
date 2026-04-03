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
import { useEffect, useRef, useState } from "react";
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
  /** The trigger element that opens the dialog */
  trigger: ReactNode;
  /** Optional unit of measure label (e.g., "pcs", "liters") */
  unitOfMeasure?: string | null;
  /** Maximum quantity available for checkout */
  availableQuantity?: number;
}

/**
 * Dialog for assigning quantity custody of a QUANTITY_TRACKED asset
 * to a team member.
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
}: QuantityCustodyDialogProps) {
  const [open, setOpen] = useState(false);
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
    if (fetcher.state === "idle" && fetcher.data) {
      setOpen(false);
      setSelectedTeamMemberId(null);
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>

      <AlertDialogContent>
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
