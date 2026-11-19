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
import { useEffect, useState } from "react";
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
    : "Your report is saved in the asset's history. No one else receives problem reports in this workspace, so no email was sent.";
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
}: ReportProblemDialogProps) {
  const fetcher = useFetcher<ReportProblemResponse>({
    key: `report-problem-${assetId}`,
  });
  const disabled = useDisabled(fetcher);
  const outcome = useFetcherOutcomeSinceOpen(fetcher, open);
  const [clientError, setClientError] = useState<string | null>(null);
  const textareaRef = useAutoFocus<HTMLTextAreaElement>({ when: open });

  useEffect(() => {
    if (open) setClientError(null);
  }, [open]);

  const sent = outcome.status === "accepted";
  const notifiedCount = fetcher.data?.notifiedCount ?? 0;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const content = new FormData(event.currentTarget).get("content");
    const parsed = problemReportContentSchema.safeParse(
      typeof content === "string" ? content : ""
    );
    if (!parsed.success) {
      event.preventDefault();
      setClientError(
        parsed.error.issues[0]?.message ?? "Describe the problem."
      );
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent onEscapeKeyDown={() => onOpenChange(false)}>
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
              error={clientError || outcome.message || undefined}
              onChange={() => setClientError(null)}
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
