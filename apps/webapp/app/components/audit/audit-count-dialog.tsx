/**
 * Audit Count Dialog
 *
 * Asks how many units of a quantity-tracked asset the auditor found. Opens
 * when such an asset is scanned for the first time, when it is scanned again
 * (to correct the count) and from a scanned row's "Edit count" button.
 *
 * For an asset on the audit's list, the field starts at the count already
 * recorded, or at the expected units for a first count, so a full pool is one
 * confirm away, and "All here" records the expected units directly. An asset
 * with nothing expected (a pool with no units at the audited location) and an
 * asset that is not on the list have no expectation to confirm: the field
 * starts at its recorded count or blank, and there is no "All here". A count may go past
 * the expectation: a surplus is a finding the audit must record. Zero is a
 * real answer (the pool was located, empty); a blank field is not, and keeps
 * Save disabled.
 *
 * State lives in `auditCountPromptAtom`; the scan route owns what happens on
 * save and cancel, because it owns the persistence refs.
 *
 * @see {@link file://./../../routes/_layout+/audits.$auditId.scan.tsx}
 * @see {@link file://./../../modules/audit/quantity.ts}
 */

import type { FormEvent } from "react";
import { useState } from "react";
import { countPromptDefault } from "@shelf/quantity-control";
import { useAtomValue } from "jotai";
import { auditCountPromptAtom } from "~/atoms/qr-scanner";
import { countExpectation } from "~/components/audit/audit-count-flow";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { MAX_AUDIT_FOUND_QUANTITY } from "~/modules/audit/quantity";

/** Props for {@link AuditCountDialog}. */
type AuditCountDialogProps = {
  /** Called with the confirmed count. */
  onSave: (count: number) => void;
  /** Called when the auditor closes the dialog without a count. */
  onCancel: () => void;
};

/**
 * The count prompt for the open {@link auditCountPromptAtom} entry. Renders
 * nothing while no count is being asked for.
 */
export function AuditCountDialog({ onSave, onCancel }: AuditCountDialogProps) {
  const prompt = useAtomValue(auditCountPromptAtom);

  if (!prompt) return null;

  // Keyed on the asset and mode so each prompt starts from its own default.
  return (
    <AuditCountDialogContent
      key={`${prompt.assetId}:${prompt.mode}`}
      assetTitle={prompt.assetTitle}
      expectedQuantity={prompt.expectedQuantity}
      foundQuantity={prompt.foundQuantity}
      unitOfMeasure={prompt.unitOfMeasure}
      isExpected={prompt.isExpected}
      mode={prompt.mode}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

/** Props for {@link AuditCountDialogContent}. */
type AuditCountDialogContentProps = AuditCountDialogProps & {
  assetTitle: string;
  expectedQuantity: number;
  foundQuantity: number | null;
  unitOfMeasure: string | null;
  isExpected: boolean;
  mode: "first" | "recount";
};

/** The open dialog. Holds the typed value as text so blank stays blank. */
function AuditCountDialogContent({
  assetTitle,
  expectedQuantity,
  foundQuantity,
  unitOfMeasure,
  isExpected,
  mode,
  onSave,
  onCancel,
}: AuditCountDialogContentProps) {
  const expectation = countExpectation({ isExpected, expectedQuantity });
  // Same rule as the phone's count sheet, from `@shelf/quantity-control`.
  const initial = countPromptDefault({
    isExpected,
    expectedQuantity,
    foundQuantity,
  });
  const [value, setValue] = useState(initial === null ? "" : String(initial));
  const inputRef = useAutoFocus<HTMLInputElement>();
  const unit = unitOfMeasure && unitOfMeasure !== "units" ? unitOfMeasure : "";
  const parsed = value.trim() === "" ? null : Number(value);
  const isValid =
    parsed !== null &&
    Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= MAX_AUDIT_FOUND_QUANTITY;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isValid && parsed !== null) onSave(parsed);
  }

  return (
    // Escape closes the dialog through `onOpenChange`, so it cancels once.
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === "recount" ? "Update count" : "How many did you find?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {expectation === "expected"
              ? `${assetTitle} is tracked by quantity. ${expectedQuantity}${
                  unit ? ` ${unit}` : ""
                } expected.`
              : expectation === "none-expected"
              ? `${assetTitle} is tracked by quantity. None expected here. Count the units you found.`
              : `${assetTitle} is tracked by quantity and is not on this audit's list. Count the units you found.`}
            {mode === "recount" && foundQuantity !== null
              ? ` Counted so far: ${foundQuantity}.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <Input
              ref={inputRef}
              label="Units found"
              name="foundQuantity"
              type="number"
              inputMode="numeric"
              min={0}
              max={MAX_AUDIT_FOUND_QUANTITY}
              step={1}
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              className="w-40"
              error={
                value.trim() !== "" && !isValid
                  ? "Enter a whole number, 0 or more."
                  : undefined
              }
            />
            {unit ? (
              <span className="pb-3 text-sm text-gray-500">{unit}</span>
            ) : null}
          </div>

          <AlertDialogFooter className="flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onCancel}>
              {mode === "first" ? "Discard scan" : "Cancel"}
            </Button>
            {expectation === "expected" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => onSave(expectedQuantity)}
              >
                All here ({expectedQuantity})
              </Button>
            ) : null}
            <Button type="submit" variant="primary" disabled={!isValid}>
              Save count
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
