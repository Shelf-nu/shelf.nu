/**
 * Audit Count Dialog
 *
 * Asks how many units of a quantity-tracked asset the auditor found. Opens
 * when such an asset is scanned for the first time, when it is scanned again
 * (to correct the count) and from a scanned row's "Edit count" button.
 *
 * The field starts at the count already recorded, or at the expected units for
 * a first count, so a full pool is one confirm away. "All here" records the
 * expected units directly. A count runs from 0 to the expected units, the same
 * bounds as the phone's count sheet. Zero is a real answer (the pool was
 * located, empty); a blank field is not, and keeps Save disabled.
 *
 * State lives in `auditCountPromptAtom`; the scan route owns what happens on
 * save and cancel, because it owns the persistence refs.
 *
 * @see {@link file://./../../routes/_layout+/audits.$auditId.scan.tsx}
 * @see {@link file://./../../modules/audit/quantity.ts}
 */

import type { FormEvent } from "react";
import { useState } from "react";
import { useAtomValue } from "jotai";
import { auditCountPromptAtom } from "~/atoms/qr-scanner";
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
  mode: "first" | "recount";
};

/** The open dialog. Holds the typed value as text so blank stays blank. */
function AuditCountDialogContent({
  assetTitle,
  expectedQuantity,
  foundQuantity,
  unitOfMeasure,
  mode,
  onSave,
  onCancel,
}: AuditCountDialogContentProps) {
  const [value, setValue] = useState(String(foundQuantity ?? expectedQuantity));
  const inputRef = useAutoFocus<HTMLInputElement>();
  const unit = unitOfMeasure && unitOfMeasure !== "units" ? unitOfMeasure : "";
  const parsed = value.trim() === "" ? null : Number(value);
  const isValid =
    parsed !== null &&
    Number.isInteger(parsed) &&
    parsed >= 0 &&
    parsed <= expectedQuantity;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isValid && parsed !== null) onSave(parsed);
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent onEscapeKeyDown={onCancel}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {mode === "recount" ? "Update count" : "How many did you find?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {assetTitle} is tracked by quantity. {expectedQuantity}
            {unit ? ` ${unit}` : ""} expected.
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
              max={expectedQuantity}
              step={1}
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              className="w-40"
              error={
                value.trim() !== "" && !isValid
                  ? `Enter a whole number from 0 to ${expectedQuantity}.`
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
            <Button
              type="button"
              variant="secondary"
              onClick={() => onSave(expectedQuantity)}
            >
              All here ({expectedQuantity})
            </Button>
            <Button type="submit" variant="primary" disabled={!isValid}>
              Save count
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
