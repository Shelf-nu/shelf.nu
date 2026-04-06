/**
 * Quantity Custody List
 *
 * Displays a breakdown of custodians and their assigned quantities for a
 * QUANTITY_TRACKED asset. Each row shows the custodian name, quantity held,
 * and a "Release" button. An "Assign" button in the header opens the
 * QuantityCustodyDialog.
 *
 * If no custody records exist, a placeholder message with the available
 * quantity is shown instead.
 *
 * @see {@link file://./quantity-custody-dialog.tsx} - Assign custody dialog
 * @see {@link file://../../routes/api+/assets.release-quantity-custody.ts} - Release endpoint
 * @see {@link file://../../routes/_layout+/assets.$assetId.overview.tsx} - Consumer
 */

import { useEffect, useRef, useState } from "react";
import type { User } from "@prisma/client";
import { useFetcher } from "react-router";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
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
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { QuantityCustodyDialog } from "./quantity-custody-dialog";

/** Shape of a custody record as provided by the overview loader */
interface CustodyRecord {
  createdAt: string | Date;
  quantity?: number;
  custodian: {
    id: string;
    name: string;
    userId?: string | null;
    user?: Partial<
      Pick<User, "firstName" | "lastName" | "profilePicture" | "email">
    > | null;
  };
}

/** Props for the QuantityCustodyList component */
export interface QuantityCustodyListProps {
  /** The custody records for the asset */
  custody: CustodyRecord[] | null;
  /** The ID of the asset */
  assetId: string;
  /** Optional unit of measure label (e.g., "pcs", "liters") */
  unitOfMeasure?: string | null;
  /** Quantity currently available for checkout */
  availableQuantity?: number;
}

/**
 * Renders a sidebar card showing the custody breakdown for a
 * QUANTITY_TRACKED asset.
 *
 * Displays each custodian with their quantity and a release button.
 * The header includes an "Assign" button that opens the custody dialog.
 *
 * @param props - Custody data and asset identifiers
 * @returns Card element with custody breakdown
 */
export function QuantityCustodyList({
  custody,
  assetId,
  unitOfMeasure,
  availableQuantity,
}: QuantityCustodyListProps) {
  const unitLabel = unitOfMeasure || "units";
  const records = custody ?? [];

  return (
    <Card className={tw("my-3 p-0")}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-[14px] font-semibold text-gray-900">
          Custody Breakdown
        </h3>
        <QuantityCustodyDialog
          assetId={assetId}
          unitOfMeasure={unitOfMeasure}
          availableQuantity={availableQuantity}
          trigger={
            <Button type="button" variant="secondary" className="py-1 text-xs">
              Assign
            </Button>
          }
        />
      </div>

      {/* List of custodians */}
      {records.length > 0 ? (
        <ul>
          {records.map((record) => (
            <CustodyRow
              key={record.custodian.id}
              record={record}
              assetId={assetId}
              unitLabel={unitLabel}
            />
          ))}
        </ul>
      ) : (
        <div className="px-4 py-6 text-center text-sm text-gray-500">
          No custody assigned.
          {availableQuantity != null ? (
            <span className="mt-1 block">
              {availableQuantity} {unitLabel} available
            </span>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*                              CustodyRow                                    */
/* -------------------------------------------------------------------------- */

/** Props for a single custody row */
interface CustodyRowProps {
  record: CustodyRecord;
  assetId: string;
  unitLabel: string;
}

/**
 * Renders a single custodian row with their name, quantity, and a release button.
 *
 * The release button opens a confirmation dialog where the user can specify
 * how many units to release.
 *
 * @param props - The custody record and context
 */
function CustodyRow({ record, assetId, unitLabel }: CustodyRowProps) {
  const custodianName = resolveTeamMemberName(record.custodian);
  const quantity = record.quantity ?? 1;

  return (
    <li className="flex items-center justify-between border-b border-gray-100 px-4 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <img
          src={
            record.custodian.user?.profilePicture ||
            "/static/images/default_pfp.jpg"
          }
          alt={custodianName}
          className="size-8 rounded"
        />
        <div>
          <p className="text-[14px] font-medium text-gray-900">
            {custodianName}
          </p>
          <p className="text-[12px] text-gray-500">
            {quantity} {unitLabel}
          </p>
        </div>
      </div>

      <ReleaseButton
        assetId={assetId}
        teamMemberId={record.custodian.id}
        maxQuantity={quantity}
        unitLabel={unitLabel}
      />
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*                             ReleaseButton                                  */
/* -------------------------------------------------------------------------- */

/** Props for the release button/dialog */
interface ReleaseButtonProps {
  assetId: string;
  teamMemberId: string;
  maxQuantity: number;
  unitLabel: string;
}

/**
 * A button that opens a confirmation dialog to release (return) quantity
 * from a custodian back to the available pool.
 *
 * @param props - Asset and custodian identifiers plus constraints
 */
function ReleaseButton({
  assetId,
  teamMemberId,
  maxQuantity,
  unitLabel,
}: ReleaseButtonProps) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher({ key: `release-qty-${teamMemberId}` });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);
  const isSubmitting = isFormProcessing(fetcher.state);

  /** Close the dialog after a successful release */
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error) {
      setOpen(false);
      formRef.current?.reset();
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="secondary" className="py-1 text-xs">
          Release
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent onEscapeKeyDown={() => setOpen(false)}>
        <AlertDialogHeader>
          <AlertDialogTitle>Release Quantity</AlertDialogTitle>
          <AlertDialogDescription>
            Enter the number of {unitLabel} to release back to the available
            pool. Maximum: {maxQuantity}.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form
          ref={formRef}
          method="POST"
          action="/api/assets/release-quantity-custody"
        >
          <input type="hidden" name="assetId" value={assetId} />
          <input type="hidden" name="teamMemberId" value={teamMemberId} />

          <div className="flex flex-col gap-4">
            <Input
              name="quantity"
              type="number"
              label={`Quantity (${unitLabel})`}
              placeholder={`Max: ${maxQuantity}`}
              min={1}
              max={maxQuantity}
              step={1}
              required
              autoFocus
              defaultValue={maxQuantity}
            />

            <Input
              name="note"
              inputType="textarea"
              label="Note (optional)"
              placeholder="Reason for release..."
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
              {isSubmitting ? "Releasing..." : "Release"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
