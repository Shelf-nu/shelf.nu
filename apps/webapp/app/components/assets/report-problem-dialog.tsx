/**
 * Report Problem Dialog
 *
 * "Report a problem" on the asset page: one text area, Cancel and Send. Opened
 * from the header's Actions menu, rendered beside the menu and controlled by
 * it. On success the dialog stays open and says where the report went, because
 * a member without the Activity tab has no other sign that it arrived.
 *
 * @see {@link file://../../routes/_layout+/assets.$assetId.report-problem.tsx}
 * @see {@link file://./actions-dropdown.tsx}
 */
import type { FormEvent } from "react";
import { useReducer } from "react";
import { useFetcher } from "react-router";
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
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import {
  PROBLEM_REPORT_MAX_LENGTH,
  problemReportContentSchema,
} from "~/modules/problem-report/schema";
import { PROBLEM_REPORT_AUDIENCE } from "~/utils/permissions/role-audience";

/** Props for {@link ReportProblemDialog}. */
export type ReportProblemDialogProps = {
  assetId: string;
  assetTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus goes when the dialog closes: the menu row that opened it
   * unmounts with the menu, so the opener passes its visible trigger.
   */
  returnFocusTo?: () => HTMLElement | null;
};

/** What the action answers on success. */
type ReportProblemResponse = {
  notifiedCount?: number;
  error?: { message?: string } | null;
};

/**
 * The confirmation shown once the report is saved.
 *
 * @param notifiedCount - How many people were emailed
 * @returns The sentence for the dialog
 */
export function reportSentMessage(notifiedCount: number) {
  return notifiedCount > 0
    ? `Your report was sent to the ${PROBLEM_REPORT_AUDIENCE} of this workspace by email, and it is saved in the asset's history.`
    : "Your report is saved in the asset's history. No email was sent.";
}

/** What the text field shows besides the text: errors for this opening only. */
type FieldState = {
  /** The `open` this state belongs to, to notice the next opening. */
  open: boolean;
  /** The schema's complaint about the text, before anything is sent. */
  clientError: string | null;
  /**
   * The server refusal the member has started editing away from. It stays
   * hidden until the next submit, which may answer with the same message.
   */
  dismissedRefusal: string | null;
};

type FieldAction =
  | { type: "openChanged"; open: boolean }
  | { type: "submitted"; clientError: string | null }
  | { type: "edited"; refusal: string | null };

function fieldReducer(state: FieldState, action: FieldAction): FieldState {
  switch (action.type) {
    case "openChanged":
      return { open: action.open, clientError: null, dismissedRefusal: null };
    case "submitted":
      return {
        ...state,
        clientError: action.clientError,
        dismissedRefusal: null,
      };
    case "edited":
      // Typing changes nothing here most of the time: keep the same state so
      // a keystroke does not re-render the dialog.
      return state.clientError === null &&
        state.dismissedRefusal === action.refusal
        ? state
        : { ...state, clientError: null, dismissedRefusal: action.refusal };
  }
}

/**
 * The dialog. Each opening starts empty and answers only the report sent
 * from that opening.
 *
 * @param props - The asset and the controlled open state
 */
export function ReportProblemDialog({
  assetId,
  assetTitle,
  open,
  onOpenChange,
  returnFocusTo,
}: ReportProblemDialogProps) {
  const fetcher = useFetcher<ReportProblemResponse>({
    key: `report-problem-${assetId}`,
  });
  const disabled = useDisabled(fetcher);
  const outcome = useFetcherOutcomeSinceOpen(fetcher, open);
  const [field, dispatch] = useReducer(fieldReducer, {
    open,
    clientError: null,
    dismissedRefusal: null,
  });
  // Each opening starts clean. Updated while rendering, so a stale error
  // never shows for a frame on the new opening.
  if (field.open !== open) dispatch({ type: "openChanged", open });
  const textareaRef = useAutoFocus<HTMLTextAreaElement>({ when: open });

  const sent = outcome.status === "accepted";
  // Read only once this opening's report is accepted, so it is this report's.
  const notifiedCount = fetcher.data?.notifiedCount ?? 0;
  const closeRef = useAutoFocus<HTMLElement>({ when: sent });
  // A refusal always says something, even when the response carried no text.
  const refusal =
    outcome.status === "rejected"
      ? outcome.message || "The report could not be sent. Try again."
      : null;
  const serverError =
    refusal && refusal !== field.dismissedRefusal ? refusal : null;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const content = new FormData(event.currentTarget).get("content");
    const parsed = problemReportContentSchema.safeParse(
      typeof content === "string" ? content : ""
    );
    if (!parsed.success) event.preventDefault();
    dispatch({
      type: "submitted",
      clientError: parsed.success
        ? null
        : parsed.error.issues[0]?.message ?? "Describe the problem.",
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          // While the report is sending, the dialog stays open so the member
          // sees whether it arrived, as Cancel is disabled then too.
          if (disabled) {
            event.preventDefault();
            return;
          }
          onOpenChange(false);
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo?.();
          if (!target) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {sent ? "Report sent" : "Report a problem"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {sent ? (
              <span role="status">{reportSentMessage(notifiedCount)}</span>
            ) : (
              <>
                Tell the {PROBLEM_REPORT_AUDIENCE} of this workspace what is
                wrong with <strong>{assetTitle}</strong>.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {sent ? (
          <AlertDialogFooter className="mt-4">
            <Button
              ref={closeRef}
              type="button"
              variant="primary"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </AlertDialogFooter>
        ) : (
          <fetcher.Form
            method="POST"
            action={`/assets/${assetId}/report-problem`}
            onSubmit={handleSubmit}
          >
            <Input
              ref={textareaRef}
              name="content"
              inputType="textarea"
              label="What is wrong?"
              placeholder="For example: the battery does not charge."
              rows={4}
              required
              characterLimit={PROBLEM_REPORT_MAX_LENGTH}
              disabled={disabled}
              error={field.clientError || serverError || undefined}
              onChange={() => dispatch({ type: "edited", refusal })}
            />
            <AlertDialogFooter className="mt-4">
              <Button
                type="button"
                variant="secondary"
                disabled={disabled}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={disabled}>
                {disabled ? "Sending..." : "Send"}
              </Button>
            </AlertDialogFooter>
          </fetcher.Form>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
