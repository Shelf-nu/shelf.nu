/**
 * Dialog that saves the report currently shown in the builder.
 *
 * Posts `save-report` to `/reports/builder` through the fetcher it is given so
 * the page does not navigate. Server-side errors (empty name, duplicate name,
 * cap reached) are shown under the name field as the fallback the form
 * validation pattern requires.
 *
 * @see {@link file://./saved-reports-menu.tsx}
 * @see {@link file://../../../modules/reports/saved/schemas.ts}
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
import { describeSavedReportQuery } from "~/modules/reports/saved/describe";
import { SaveReportFormSchema } from "~/modules/reports/saved/schemas";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";

/** Props for {@link SaveReportDialog}. */
type Props = {
  open: boolean;
  onClose: () => void;
  /** The sanitised query string that will be stored. */
  query: string;
  name: string;
  onNameChange: (event: ChangeEvent<HTMLInputElement>) => void;
  fetcher: FetcherWithComponents<DataOrErrorResponse>;
  /**
   * The answer to a submission made since this dialog opened, or `undefined`
   * when nothing has been submitted yet. A fetcher keeps its last response, so
   * reading it directly would show an earlier failure the moment the dialog
   * opens again.
   */
  outcome: DataOrErrorResponse | undefined;
};

/** Renders the save dialog. */
export function SaveReportDialog({
  open,
  onClose,
  query,
  name,
  onNameChange,
  fetcher,
  outcome,
}: Props) {
  const zo = useZorm("save-report", SaveReportFormSchema);
  const nameInputRef = useAutoFocus<HTMLInputElement>({ when: open });
  const disabled = useDisabled(fetcher);

  const validationErrors = getValidationErrors<typeof SaveReportFormSchema>(
    outcome?.error
  );
  const nameError =
    validationErrors?.name?.message ??
    zo.errors.name()?.message ??
    outcome?.error?.message;

  return (
    <DialogPortal>
      <Dialog
        wrapperClassName="!z-[9999]"
        open={open}
        onClose={onClose}
        title={
          <div className="-mb-3 w-full pb-6">
            <h3>Save report</h3>
            <p className="text-gray-500">
              Everyone with access to Reports in this workspace can open it.
            </p>
          </div>
        }
      >
        <div className="px-6 pb-5">
          <fetcher.Form method="post" ref={zo.ref}>
            <input type="hidden" name="intent" value="save-report" />
            <input type="hidden" name="query" value={query} />
            <Input
              ref={nameInputRef}
              label="Report name"
              name="name"
              value={name}
              onChange={onNameChange}
              placeholder="e.g. Laptops by campus"
              maxLength={SAVED_REPORT_NAME_MAX_LENGTH}
              error={nameError}
            />

            <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
              <p className="mb-1 text-xs font-medium text-gray-600">
                What it shows
              </p>
              <p className="text-sm text-gray-700">
                {describeSavedReportQuery(query)}
              </p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || disabled}>
                {disabled ? "Saving..." : "Save"}
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Dialog>
    </DialogPortal>
  );
}
