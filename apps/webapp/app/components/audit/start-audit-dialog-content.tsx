/**
 * Shared body for the "Start an audit" bulk dialog.
 *
 * Renders the audit name / description / due-date inputs, the assignee selector,
 * and the footer buttons used by every bulk "Create audit" entry point (assets
 * index, locations index, …). It is intentionally stateless with respect to the
 * selection: the parent dialog wires the `arrayFieldId` + zorm schema, and this
 * component only renders the common fields and redirects on a successful submit.
 *
 * Lifted out of `~/components/assets/bulk-start-audit-dialog` so the locations
 * (and any future) bulk-audit dialogs reuse the exact same form, with no change
 * to the assets runtime behavior.
 *
 * @see {@link file://./../assets/bulk-start-audit-dialog.tsx}
 * @see {@link file://./../location/bulk-start-audit-dialog.tsx}
 */

import type { ChangeEvent } from "react";
import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router";

import AuditTeamMemberSelector from "~/components/audit/audit-team-member-selector";
import Input from "~/components/forms/input";
import { Button } from "~/components/shared/button";
import { Separator } from "~/components/shared/separator";
import { useDisabled } from "~/hooks/use-disabled";

/**
 * Maximum length (in characters) of the optional audit description field.
 *
 * Enforces the textarea `maxLength` and drives the live character counter
 * shown beneath the description input.
 */
export const AUDIT_DESCRIPTION_MAX_LENGTH = 1000;

/**
 * Shape of the fetcher response returned by `/api/audits/start`.
 *
 * @property success - Whether the audit was created successfully.
 * @property redirectTo - URL of the newly-created audit to navigate to on success.
 */
export type StartAuditFetcherData = {
  success?: boolean;
  redirectTo?: string;
};

/**
 * Props for the {@link StartAuditDialogContent} component.
 *
 * @property disabled - Whether the dialog action is in flight (from the bulk-dialog harness).
 * @property handleCloseDialog - Closes the parent dialog.
 * @property fetcherError - Server error to surface (shown under the description field).
 * @property fetcherData - Fetcher response; on success the form navigates to `redirectTo`.
 * @property nameField - Zorm field name for the audit name input.
 * @property descriptionField - Zorm field name for the description input.
 * @property dueDateField - Zorm field name for the due-date input.
 * @property nameError - Validation error for the name field.
 * @property descriptionError - Validation error for the description field.
 * @property dueDateError - Validation error for the due-date field.
 * @property assigneeError - Validation error for the assignee selector.
 */
export type StartAuditDialogContentProps = {
  disabled: boolean;
  handleCloseDialog: () => void;
  fetcherError?: string;
  fetcherData?: StartAuditFetcherData;
  nameField: string;
  descriptionField: string;
  dueDateField: string;
  nameError?: string;
  descriptionError?: string;
  dueDateError?: string;
  assigneeError?: string;
};

/**
 * Shared inner form for the bulk "Create audit" dialogs (assets, locations, …).
 *
 * Renders the audit name, description (with a live character counter), and
 * due-date inputs plus the assignee selector and footer buttons. On a
 * successful fetcher response it navigates to the newly-created audit.
 *
 * @param props - See {@link StartAuditDialogContentProps}.
 * @returns The dialog's form fields and footer buttons.
 */
export function StartAuditDialogContent({
  disabled,
  handleCloseDialog,
  fetcherError,
  fetcherData,
  nameField,
  descriptionField,
  dueDateField,
  nameError,
  descriptionError,
  dueDateError,
  assigneeError,
}: StartAuditDialogContentProps) {
  const navigate = useNavigate();
  const isNavigating = useDisabled();
  const formDisabled = disabled || isNavigating;
  const [descriptionLength, setDescriptionLength] = useState(0);
  // Unique id so the description input can reference its character counter via
  // aria-describedby — the dialog body is shared and may render in multiple
  // contexts, so a static id could collide.
  const descriptionCounterId = useId();

  const handleDescriptionChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setDescriptionLength(event.currentTarget.value.length);
  };

  useEffect(() => {
    if (!fetcherData?.success || !fetcherData.redirectTo) {
      return;
    }

    void navigate(fetcherData.redirectTo);
  }, [fetcherData, navigate]);

  return (
    <>
      <div className="grid grid-cols-1 border-t px-6 pb-4 md:grid-cols-2 md:divide-x">
        {/* Left column: Form fields */}
        <div className="py-4 pr-6">
          <Input
            name={nameField}
            label="Audit name"
            placeholder="Quarterly warehouse audit"
            error={nameError}
            required
            disabled={formDisabled}
            className="mb-4"
          />

          <Input
            name={descriptionField}
            label="Description"
            placeholder="Add context that will help auditors (optional)."
            inputType="textarea"
            rows={5}
            maxLength={AUDIT_DESCRIPTION_MAX_LENGTH}
            error={fetcherError || descriptionError}
            disabled={formDisabled}
            className="mb-1"
            onChange={handleDescriptionChange}
            aria-describedby={descriptionCounterId}
          />
          <div
            id={descriptionCounterId}
            className="text-right text-xs text-gray-500"
            aria-live="polite"
          >
            {descriptionLength}/{AUDIT_DESCRIPTION_MAX_LENGTH}
          </div>

          <Input
            name={dueDateField}
            label="Due date"
            type="datetime-local"
            error={dueDateError}
            disabled={formDisabled}
            className="mt-4"
          />
        </div>

        {/* Right column: Team member selector */}
        <div className="!border-r">
          <Separator className="md:hidden" />
          <p className="p-3 pb-0 font-medium">Select assignee (optional).</p>
          <p className="border-b p-3 ">
            If no assignee is selected, any admin user can perform the audit.
            This can also be done by multiple users at different times.
          </p>
          <AuditTeamMemberSelector error={assigneeError} />
        </div>
      </div>

      {/* Footer buttons */}
      <div className="flex items-center justify-end gap-2 border-t p-4 pb-0 md:col-span-2">
        <Button
          type="button"
          variant="secondary"
          disabled={formDisabled}
          onClick={handleCloseDialog}
        >
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={formDisabled}>
          Create audit
        </Button>
      </div>
    </>
  );
}
