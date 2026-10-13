/**
 * Type To Confirm
 *
 * The shared "type X to confirm" field for permanent deletes. A dialog asks
 * for the item's name (single delete) or the number of selected items (bulk
 * delete) and keeps its destructive button disabled until the typed value
 * matches. Matching is {@link deleteConfirmationMatches} from `@shelf/labels`,
 * the same rule the server guard on bulk deletes and the companion's delete
 * sheets apply, so an enabled button is never refused for a spelling
 * difference.
 *
 * The field posts under {@link DELETE_CONFIRMATION_FIELD} so the server can read
 * what was typed. When the input sits outside the `<form>` that submits (the
 * single-delete dialogs keep the form around the button only), pass `form`.
 *
 * @see {@link file://./../../utils/delete-confirmation.server.ts} - Server guard
 * @see {@link file://./../../../../../packages/labels/index.js} - Matching rule
 */
import { useCallback, useId, useState } from "react";
import {
  DELETE_CONFIRMATION_FIELD,
  deleteConfirmationMatches,
} from "@shelf/labels";
import Input from "~/components/forms/input";

/**
 * State for one {@link TypeToConfirm} field.
 *
 * @param expected - The name or count the user must type
 * @returns The typed `value`, a setter, whether it `isConfirmed`, and `reset`
 *   for when the dialog closes, so the next open starts empty
 */
export function useTypeToConfirm(expected: string | number) {
  const [value, setValue] = useState("");
  const isConfirmed = deleteConfirmationMatches(value, expected);
  const reset = useCallback(() => setValue(""), []);

  return { value, setValue, isConfirmed, reset };
}

type TypeToConfirmProps = {
  /** The name or count the user must type, shown in bold in the instruction. */
  expected: string | number;
  /** The typed value, from {@link useTypeToConfirm}. */
  value: string;
  /** Receives every change, from {@link useTypeToConfirm}. */
  onChange: (value: string) => void;
  /**
   * Id of the `<form>` the field belongs to, when it is rendered outside it.
   * Omit when the field is inside the form that submits.
   */
  form?: string;
  /** Disables the field while the delete is submitting. */
  disabled?: boolean;
  /** A refusal to show under the field, e.g. from the server. */
  error?: string;
};

/**
 * The instruction and input of a typed delete confirmation.
 *
 * @param props - See {@link TypeToConfirmProps}
 */
export function TypeToConfirm({
  expected,
  value,
  onChange,
  form,
  disabled,
  error,
}: TypeToConfirmProps) {
  const hintId = useId();

  return (
    <div className="space-y-2">
      <p id={hintId} className="text-sm text-gray-600">
        To confirm, type{" "}
        <span className="break-all font-semibold text-gray-900">
          {expected}
        </span>{" "}
        below.
      </p>
      <Input
        label="Confirmation"
        name={DELETE_CONFIRMATION_FIELD}
        form={form}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={disabled}
        error={error}
        aria-describedby={hintId}
        data-test-id="delete-confirmation-input"
      />
    </div>
  );
}
