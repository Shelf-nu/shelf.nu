/**
 * Quantity Custody List
 *
 * Displays a breakdown of custodians and their assigned quantities for a
 * QUANTITY_TRACKED asset. Each row shows the custodian name, quantity held,
 * and an action that ends the hold. An "Assign" button in the header opens
 * the QuantityCustodyDialog.
 *
 * The action's wording follows the asset's `consumptionType`: a returnable
 * (`TWO_WAY`) asset offers "Release" back to the pool, a consumable
 * (`ONE_WAY`) offers "Mark as consumed", which permanently reduces stock. A
 * consumable additionally asks how many of the released units were used up,
 * so unused stock can be handed back instead of destroyed.
 *
 * Both post to the same endpoint — the server derives the outcome from the
 * asset row, so this is presentation only, never the authority. An explicit
 * split can only ever narrow a consumable's outcome; the server rejects it
 * outright for a returnable asset.
 *
 * If no custody records exist, a placeholder message with the available
 * quantity is shown instead.
 *
 * @see {@link file://./quantity-custody-dialog.tsx} - Assign custody dialog
 * @see {@link file://../../routes/api+/assets.release-quantity-custody.ts} - Release endpoint
 * @see {@link file://../../routes/_layout+/assets.$assetId.overview.tsx} - Consumer
 */

import { useEffect, useReducer, useRef, useState } from "react";
import type { ConsumptionType, User } from "@prisma/client";
import { releaseCategory } from "@shelf/quantity-control";
import { Link, useFetcher } from "react-router";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { QuantityCustodyDialog } from "./quantity-custody-dialog";

/** Shape of a custody record as provided by the overview loader */
interface CustodyRecord {
  createdAt: string | Date;
  quantity?: number;
  /** When set, this row was inherited from a kit's custody. The UI must
   * not allow direct release — the only legitimate way to clear it is
   * to release the parent kit's custody (which cascades). */
  kitCustodyId?: string | null;
  /** Parent kit info for the "held via kit" badge tooltip. */
  kitCustody?: {
    kit: { id: string; name: string };
  } | null;
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
  /** How the asset is consumed. `ONE_WAY` swaps "Release" for
   * "Mark as consumed" and adds a second field for the used-up count, because
   * a consumable's units default to gone for good. */
  consumptionType?: ConsumptionType | null;
  /** Quantity currently available for checkout */
  availableQuantity?: number;
  /** Whether the current user is self-service */
  isSelfService?: boolean;
  /** The current user's ID (used for self-service filtering) */
  currentUserId?: string;
  /** Whether the user has permission to view other people's custody */
  canViewAllCustody?: boolean;
  /** Whether the user has permission to assign/release custody */
  canCustody?: boolean;
  /** When the asset is part of a kit (any status), surface that to the
   * Assign dialog as a soft informational note so the user knows operator
   * custody is tracked separately from the kit's allocation. */
  inKit?: { id: string; name: string } | null;
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
  consumptionType,
  availableQuantity,
  isSelfService = false,
  currentUserId,
  canViewAllCustody = true,
  canCustody = true,
  inKit,
}: QuantityCustodyListProps) {
  const unitLabel = unitOfMeasure || "units";
  const allRecords = custody ?? [];

  /**
   * The shared predicate decides this, so the label can never disagree with
   * what the server does. Legacy rows without a `consumptionType` are
   * returnable.
   */
  const isConsumable = releaseCategory(consumptionType) === "CONSUME";

  /**
   * Filter visible custody records based on permissions.
   * Self-service/base users who can't view all custody only see
   * their own records.
   */
  const records = canViewAllCustody
    ? allRecords
    : allRecords.filter((r) => r.custodian.userId === currentUserId);

  /** Number of custody records hidden due to permission restrictions */
  const hiddenCount = allRecords.length - records.length;

  const noneAvailable = availableQuantity != null && availableQuantity <= 0;

  /**
   * Self-service users can only release their own custody.
   * Admins/owners can release anyone's.
   */
  const canRelease = (record: CustodyRecord) => {
    if (!canCustody) return false;
    if (isSelfService) return record.custodian.userId === currentUserId;
    return true;
  };

  return (
    <Card className={tw("my-3 p-0")}>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-[14px] font-semibold text-gray-900">
          Custody Breakdown
        </h3>
        {canCustody ? (
          <QuantityCustodyDialog
            assetId={assetId}
            unitOfMeasure={unitOfMeasure}
            availableQuantity={availableQuantity}
            inKit={inKit}
            trigger={
              <Button
                type="button"
                variant="secondary"
                className="py-1 text-xs"
                disabled={
                  noneAvailable
                    ? {
                        reason:
                          "All units are currently in custody. Release some before assigning more.",
                      }
                    : false
                }
              >
                Assign
              </Button>
            }
          />
        ) : null}
      </div>

      {/* List of custodians */}
      {records.length > 0 ? (
        <>
          <ul>
            {records.map((record) => (
              <CustodyRow
                key={record.custodian.id}
                record={record}
                assetId={assetId}
                unitLabel={unitLabel}
                isConsumable={isConsumable}
                canRelease={canRelease(record)}
              />
            ))}
          </ul>
          {hiddenCount > 0 ? (
            <div className="border-t border-gray-100 px-4 py-3 text-[12px] text-gray-500">
              +{hiddenCount} other {hiddenCount === 1 ? "person" : "people"}{" "}
              also {hiddenCount === 1 ? "has" : "have"} custody of this asset.
            </div>
          ) : null}
        </>
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
  /** Whether the asset is a ONE_WAY consumable (see QuantityCustodyListProps) */
  isConsumable?: boolean;
  /** Whether the current user can release this custody record */
  canRelease?: boolean;
}

/**
 * Renders a single custodian row with their name, quantity, and the action
 * that ends the hold.
 *
 * The action opens a confirmation dialog where the user can specify how many
 * units to release (or, for a consumable, mark as consumed).
 *
 * @param props - The custody record and context
 */
function CustodyRow({
  record,
  assetId,
  unitLabel,
  isConsumable = false,
  canRelease = true,
}: CustodyRowProps) {
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

      {record.kitCustodyId ? (
        <KitCustodyBadge kit={record.kitCustody?.kit} />
      ) : canRelease ? (
        <ReleaseButton
          assetId={assetId}
          teamMemberId={record.custodian.id}
          maxQuantity={quantity}
          unitLabel={unitLabel}
          isConsumable={isConsumable}
        />
      ) : null}
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*                            KitCustodyBadge                                 */
/* -------------------------------------------------------------------------- */

/**
 * Replaces the Release button on rows whose custody was inherited from a kit.
 * Releasing such a row directly would corrupt the kit's state — the parent
 * KitCustody row would still mark the kit as in custody while its child rows
 * have been removed. The user must release the kit's custody to clear it
 * (which cascades through the FK).
 */
function KitCustodyBadge({
  kit,
}: {
  kit?: { id: string; name: string } | null;
}) {
  const tooltipBody = kit ? (
    <span className="block">
      Held via kit{" "}
      <Link
        to={`/kits/${kit.id}`}
        className="font-medium text-primary-600 underline"
      >
        {kit.name}
      </Link>
      . Release the kit's custody to clear this allocation.
    </span>
  ) : (
    "Held via a kit's custody. Release the kit's custody to clear this allocation."
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
            Via kit
          </span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs">
          {tooltipBody}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*                             ReleaseButton                                  */
/* -------------------------------------------------------------------------- */

/**
 * The two coupled numeric fields of a consumable release. They move together:
 * lowering the released quantity must pull the consumed count down with it, or
 * the form would post a split the server rejects.
 */
type ReleaseFormState = {
  /** Total units leaving the custodian's hold. */
  quantity: number;
  /** How many of those were used up. Never exceeds `quantity`. */
  consumed: number;
};

/** Transitions for {@link ReleaseFormState}. */
type ReleaseFormAction =
  | { type: "reset"; max: number }
  | { type: "set_quantity"; value: number; max: number }
  | { type: "set_consumed"; value: number };

/**
 * Reducer for the consumable release form. Every transition clamps, so the
 * state can never describe an invalid split.
 *
 * @param state - Current field values
 * @param action - The transition to apply
 * @returns The next state
 */
function releaseFormReducer(
  state: ReleaseFormState,
  action: ReleaseFormAction
): ReleaseFormState {
  switch (action.type) {
    case "reset":
      // Opening the dialog pre-fills a full consume — the common case for a
      // consumable, and what the server would default to anyway.
      return { quantity: action.max, consumed: action.max };
    case "set_quantity": {
      const quantity = Math.min(Math.max(action.value, 0), action.max);
      return { quantity, consumed: Math.min(state.consumed, quantity) };
    }
    case "set_consumed":
      return {
        ...state,
        consumed: Math.min(Math.max(action.value, 0), state.quantity),
      };
  }
}

/** Props for the release button/dialog */
interface ReleaseButtonProps {
  assetId: string;
  teamMemberId: string;
  maxQuantity: number;
  unitLabel: string;
  /** Consumable (ONE_WAY) assets are consumed, not returned */
  isConsumable?: boolean;
}

/**
 * A button that opens a confirmation dialog to end a custodian's hold on N
 * units — returning them to the available pool for a `TWO_WAY` asset, or
 * consuming them (permanently reducing stock) for a `ONE_WAY` consumable.
 *
 * @param props - Asset and custodian identifiers plus constraints
 */
function ReleaseButton({
  assetId,
  teamMemberId,
  maxQuantity,
  unitLabel,
  isConsumable = false,
}: ReleaseButtonProps) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher({ key: `release-qty-${teamMemberId}` });
  const disabled = useDisabled(fetcher);
  const formRef = useRef<HTMLFormElement>(null);
  const isSubmitting = isFormProcessing(fetcher.state);
  // Replaces `autoFocus` to satisfy jsx-a11y/no-autofocus. The hook
  // re-focuses on every closed → open flip and handles the rAF defer
  // needed for the Radix portal mount.
  const quantityInputRef = useAutoFocus<HTMLInputElement>({ when: open });

  const [form, dispatch] = useReducer(releaseFormReducer, {
    quantity: maxQuantity,
    consumed: maxQuantity,
  });

  /**
   * Re-seed on every closed → open flip: each open targets a fresh release,
   * so a previous split must not leak into the next one.
   */
  useEffect(() => {
    if (open) {
      dispatch({ type: "reset", max: maxQuantity });
    }
  }, [open, maxQuantity]);

  /**
   * Server-side rejection message, shown above the form.
   *
   * The reducer only clamps `consumed` against the `maxQuantity` this dialog
   * was rendered with, so a page left open while the same units move
   * elsewhere still submits a release the service refuses. `releaseQuantity`
   * also rejects a `consumed` above the released amount, and any `consumed`
   * on a returnable asset. Those messages are written for an operator to
   * read — without this the dialog just sits there with its submit button
   * re-enabled and no explanation.
   */
  const serverErrorMessage =
    fetcher.data?.error != null
      ? (fetcher.data.error as { message?: string })?.message
      : null;

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
                Choose how many {unitLabel} leave this custodian's hold, and how
                many of those were used up. Used-up units permanently reduce
                total stock and cannot be restored; the rest go back to the
                available pool. Maximum: {maxQuantity}.
              </>
            ) : (
              <>
                Enter the number of {unitLabel} to release back to the available
                pool. Maximum: {maxQuantity}.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {serverErrorMessage ? (
          // Mirrors the shape of `WarningBox` (text-sm + p-4 + 25/300/700
          // token ladder) so server-side block errors render with the same
          // weight as the inline warnings used elsewhere — just in error tone.
          // Matches `move-units-dialog.tsx`.
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

          <div className="flex flex-col gap-4">
            {isConsumable ? (
              <>
                <Input
                  ref={quantityInputRef}
                  name="quantity"
                  type="number"
                  label={`Units to release (${unitLabel})`}
                  min={1}
                  max={maxQuantity}
                  step={1}
                  required
                  value={form.quantity}
                  onChange={(event) =>
                    dispatch({
                      type: "set_quantity",
                      value: Number(event.target.value),
                      max: maxQuantity,
                    })
                  }
                />

                <Input
                  name="consumed"
                  type="number"
                  label="Of those, how many were used up?"
                  min={0}
                  max={form.quantity}
                  step={1}
                  required
                  value={form.consumed}
                  onChange={(event) =>
                    dispatch({
                      type: "set_consumed",
                      value: Number(event.target.value),
                    })
                  }
                />

                <p className="text-[12px] text-gray-500">
                  {form.consumed} of {form.quantity} {unitLabel} will be removed
                  from stock permanently
                  {form.quantity - form.consumed > 0
                    ? `; the remaining ${
                        form.quantity - form.consumed
                      } go back to the available pool`
                    : ""}
                  .
                </p>
              </>
            ) : (
              <Input
                ref={quantityInputRef}
                name="quantity"
                type="number"
                label={`Quantity (${unitLabel})`}
                placeholder={`Max: ${maxQuantity}`}
                min={1}
                max={maxQuantity}
                step={1}
                required
                defaultValue={maxQuantity}
              />
            )}

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

            <Button type="submit" variant="primary" disabled={disabled}>
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
