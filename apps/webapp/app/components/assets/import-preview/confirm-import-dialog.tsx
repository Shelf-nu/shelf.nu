/**
 * @file "Type I AGREE" confirmation dialog shared by the import flows.
 *
 * Wraps an `AlertDialog` whose confirm button stays disabled until the user
 * types the exact phrase. The typed text lives in this component and resets
 * whenever the dialog closes.
 *
 * @see {@link file://./../bulk-update/preview-display.tsx} Update-flow consumer
 */
import type React from "react";
import { useState } from "react";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import Input from "../../forms/input";
import { Button } from "../../shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../shared/modal";

/** The phrase the user must type to enable the confirm button. */
const CONFIRMATION_PHRASE = "I AGREE";

/** Props for {@link ConfirmImportDialog}. */
type ConfirmImportDialogProps = {
  /** Label of the button that opens the dialog. */
  triggerLabel: React.ReactNode;
  /** Dialog title. */
  title: React.ReactNode;
  /** Dialog body, rendered above the confirmation prompt. */
  description: React.ReactNode;
  /** Label of the confirm button while idle. */
  confirmLabel: React.ReactNode;
  /** Disables the trigger button (e.g. nothing to confirm). */
  disabled?: boolean;
  /** True while the confirmed action is running. Locks the confirm button. */
  isSubmitting: boolean;
  /** Called with the typed phrase once the user confirms. */
  onConfirm: (confirmation: string) => void;
  /** Server error to show inside the dialog. */
  error?: { message?: string } | null;
};

/**
 * Renders the trigger button and the confirmation dialog.
 *
 * @param props - See {@link ConfirmImportDialogProps}
 * @returns The dialog with its trigger
 */
export function ConfirmImportDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  disabled = false,
  isSubmitting,
  onConfirm,
  error,
}: ConfirmImportDialogProps) {
  const [agreed, setAgreed] = useState("");
  const confirmed = agreed === CONFIRMATION_PHRASE;

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          setAgreed("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button type="button" disabled={disabled}>
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-[600px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          <AlertDialogDescription>
            Type <b>"{CONFIRMATION_PHRASE}"</b> below to confirm.
          </AlertDialogDescription>
          {error ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error.message || "Something went wrong. Please try again."}
            </div>
          ) : null}
          <ConfirmationInput
            agreed={agreed}
            setAgreed={setAgreed}
            canSubmit={confirmed && !isSubmitting}
            onSubmit={() => onConfirm(agreed)}
          />
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </AlertDialogCancel>
          <Button
            type="button"
            disabled={!confirmed || isSubmitting}
            onClick={() => onConfirm(agreed)}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Text input for the confirmation phrase. It is its own component so it can
 * focus itself on mount with `useAutoFocus` instead of the `autoFocus`
 * attribute, and it only mounts while the dialog is open.
 */
function ConfirmationInput({
  agreed,
  setAgreed,
  canSubmit,
  onSubmit,
}: {
  agreed: string;
  setAgreed: (value: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
}) {
  const inputRef = useAutoFocus<HTMLInputElement>();

  return (
    <Input
      ref={inputRef}
      type="text"
      label="Confirmation"
      name="agree"
      value={agreed}
      onChange={(e) => setAgreed(e.target.value.toUpperCase())}
      placeholder={CONFIRMATION_PHRASE}
      pattern="^I AGREE$"
      required
      onKeyDown={(e) => {
        if (e.key === "Enter" && canSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }}
    />
  );
}
