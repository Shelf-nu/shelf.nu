import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Form } from "react-router";
import { MarkdownEditor } from "~/components/markdown/markdown-editor";
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

type CompleteAuditDialogProps = {
  /** Whether the button should be disabled */
  disabled?: boolean;
  /** Audit session name for display */
  auditName: string;
  /** Container for portal rendering */
  portalContainer?: HTMLElement;
  /** Stats for display in confirmation */
  stats: {
    expectedCount: number;
    foundCount: number;
    missingCount: number;
    unexpectedCount: number;
  };
};

/**
 * Dialog component for completing an audit with optional completion note.
 *
 * This component:
 * - Shows a confirmation dialog with audit statistics
 * - Allows user to add an optional markdown note
 * - Submits with intent="complete-audit"
 */
export default function CompleteAuditDialog({
  disabled,
  auditName,
  portalContainer,
  stats,
}: CompleteAuditDialogProps) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          disabled={disabled}
          variant="primary"
          icon="check"
          type="button"
        >
          Complete Audit
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent
        portalProps={{ container: portalContainer }}
        className="max-w-2xl"
      >
        <Form method="post" onSubmit={() => setOpen(false)}>
          <input type="hidden" name="intent" value="complete-audit" />
          <input type="hidden" name="note" value={note} />

          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success-500" />
              <AlertDialogTitle>Complete Audit</AlertDialogTitle>
            </div>
          </AlertDialogHeader>

          <AlertDialogDescription asChild>
            <div className="space-y-4">
              <p>
                You are about to complete the audit{" "}
                <span className="font-semibold text-gray-900">{auditName}</span>
                . This action cannot be undone.
              </p>

              <div className="rounded-lg bg-gray-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-gray-700">
                  Audit Summary
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Expected:</span>
                    <span className="font-medium">{stats.expectedCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Found:</span>
                    <span className="font-medium text-success-600">
                      {stats.foundCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Missing:</span>
                    <span className="font-medium text-error-600">
                      {stats.missingCount}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Unexpected:</span>
                    <span className="font-medium text-warning-600">
                      {stats.unexpectedCount}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="completion-note"
                  className="text-sm font-medium text-gray-700"
                >
                  Completion Note (Optional)
                </label>
                <p className="text-sm text-gray-500">
                  Add any final observations or notes about this audit.
                </p>
                <MarkdownEditor
                  id="completion-note"
                  name="note"
                  label=""
                  defaultValue={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add completion notes here (supports markdown)..."
                  className="min-h-[120px]"
                />
              </div>
            </div>
          </AlertDialogDescription>

          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="secondary" type="button">
                Cancel
              </Button>
            </AlertDialogCancel>
            <Button type="submit" variant="primary">
              Complete Audit
            </Button>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
