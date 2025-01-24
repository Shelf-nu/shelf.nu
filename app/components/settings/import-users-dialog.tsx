import { cloneElement, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { UploadIcon } from "lucide-react";
import { tw } from "~/utils/tw";
import Input from "../forms/input";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";
import { WarningBox } from "../shared/warning-box";

type ImportUsersDialogProps = {
  className?: string;
  trigger?: React.ReactElement<{ onClick: () => void }>;
};

export default function ImportUsersDialog({
  className,
  trigger,
}: ImportUsersDialogProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File>();
  const [error, setError] = useState<string>("");

  const fetcher = useFetcher();

  function openDialog() {
    setIsDialogOpen(true);
  }

  function closeDialog() {
    setIsDialogOpen(false);
  }

  function handleSelectFile(event: React.ChangeEvent<HTMLInputElement>) {
    setError("");

    const file = event.target.files?.[0];
    if (file?.type !== "text/csv") {
      setError("Invalid file type. Please select a CSV file.");
      return;
    }

    setSelectedFile(file);
  }

  return (
    <>
      {trigger ? (
        cloneElement(trigger, { onClick: openDialog })
      ) : (
        <Button
          variant="primary"
          className="mt-2 w-full md:mt-0 md:w-max"
          onClick={openDialog}
        >
          <span className=" whitespace-nowrap">Import Users</span>
        </Button>
      )}

      <DialogPortal>
        <Dialog
          className={tw("overflow-auto md:w-[calc(100vw_-_200px)]", className)}
          open={isDialogOpen}
          onClose={closeDialog}
          title={
            <div className="mt-4 inline-flex items-center justify-center rounded-full border-4 border-solid border-primary-50 bg-primary-100 p-1.5 text-primary">
              <UploadIcon />
            </div>
          }
        >
          <div className="px-6 pb-4 pt-2">
            <h3>Invite Users via CSV Upload</h3>
            <p>
              Invite multiple users to your organization by uploading a CSV
              file. To get started,{" "}
              <Button
                variant="link"
                to="/static/example-user-invite.csv"
                target="_blank"
                download
              >
                download our CSV template.
              </Button>
            </p>
            <WarningBox className="my-4">
              <>
                <strong>IMPORTANT</strong>: Use the provided template to ensure
                proper formatting. Uploading incorrectly formatted files may
                cause errors.
              </>
            </WarningBox>
            <h4>Base Rules and Limitations</h4>
            <ul className="list-inside list-disc">
              <li>
                You must use <b>, (comma)</b> as a delimiter in your CSV file.
              </li>
              <li>
                Each row represents a new user to be invited. Ensure the email
                column is valid.
              </li>
              <li>
                Invited users will receive an email with a link to join the
                organization.
              </li>
            </ul>

            <h4 className="mt-2">Extra Considerations</h4>
            <div>
              <ul className="list-inside list-disc pl-4">
                <li>
                  The first row of the sheet will be ignored. Use it for column
                  headers as in the provided template.
                </li>
                <li>
                  If any of the rows contain invalid data, they will be skipped,
                  but the valid rows will still be processed.
                </li>
              </ul>
            </div>

            <p className="mb-4">
              Once you've uploaded your file, a summary of the processed
              invitations will be displayed, along with any errors encountered.
            </p>

            <fetcher.Form action="/api/settings/import-users" method="POST">
              <Input
                type="file"
                name="file"
                label="Select a csv file"
                required
                accept=".csv"
                className="mb-2"
                error={error}
                onChange={handleSelectFile}
              />

              <Button disabled={!selectedFile}>Import now</Button>
            </fetcher.Form>
          </div>
        </Dialog>
      </DialogPortal>
    </>
  );
}
