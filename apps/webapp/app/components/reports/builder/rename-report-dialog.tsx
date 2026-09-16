/**
 * Dialog that renames a saved report.
 *
 * Posts `rename-report` to `/reports/builder` through the fetcher it is given.
 * Server-side errors (duplicate name) are shown under the name field.
 *
 * @see {@link file://./saved-reports-menu.tsx}
 */

import type { ChangeEvent } from "react";
import type { FetcherWithComponents } from "react-router";
import { useZorm } from "react-zorm";
import Input from "~/components/forms/input";
import { Dialog, DialogPortal } from "~/components/layout/dialog";
import { Button } from "~/components/shared/button";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import { SAVED_REPORT_NAME_MAX_LENGTH } from "~/modules/reports/saved/constants";
import { RenameSavedReportFormSchema } from "~/modules/reports/saved/schemas";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";

/** Props for {@link RenameReportDialog}. */
type Props = {
  open: boolean;
  onClose: () => void;
  reportId: string;
  name: string;
  onNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  fetcher: FetcherWithComponents<DataOrErrorResponse>;
};

/** Renders the rename dialog. */
export function RenameReportDialog({
  open,
  onClose,
  reportId,
  name,
  onNameChange,
  fetcher,
}: Props) {
  const zo = useZorm("rename-report", RenameSavedReportFormSchema);
  const nameInputRef = useAutoFocus<HTMLInputElement>({ when: open });
  const disabled = useDisabled(fetcher);

  const validationErrors = getValidationErrors<
    typeof RenameSavedReportFormSchema
  >(fetcher.data?.error);
  const nameError =
    validationErrors?.name?.message ??
    zo.errors.name()?.message ??
    fetcher.data?.error?.message;

  return (
    <DialogPortal>
      <Dialog
        wrapperClassName="!z-[9999]"
        open={open}
        onClose={onClose}
        title={
          <div className="-mb-3 w-full pb-6">
            <h3>Rename report</h3>
          </div>
        }
      >
        <div className="px-6 pb-5">
          <fetcher.Form method="post" ref={zo.ref}>
            <input type="hidden" name="intent" value="rename-report" />
            <input type="hidden" name="reportId" value={reportId} />
            <Input
              ref={nameInputRef}
              label="Report name"
              name="name"
              value={name}
              onChange={onNameChange}
              maxLength={SAVED_REPORT_NAME_MAX_LENGTH}
              error={nameError}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || disabled}>
                {disabled ? "Saving..." : "Rename"}
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Dialog>
    </DialogPortal>
  );
}
