import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import Input from "../forms/input";
import { Button } from "../shared";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../shared/modal";
import { isFormProcessing } from "~/utils";
import { M } from "msw/lib/glossary-de6278a9";

export const ImportBackup = () => (
  <>
    <h3>Import from backup</h3>
    <p>
      This option allows you to import assets that have been exported from
      shelf. It can be used to restore a backup or move assets from one account
      to another.
    </p>
    <br />
    <p>This feature comes with some important limitations:</p>
    <ul className="list-inside list-disc">
      <li>Assets will be imported with all their relationships</li>
      <li>
        Assets will not be merged with existing ones. A asset with a new ID will
        be created for each one
      </li>
      <li>
        If you have modified the exported file, there is the possibility of the
        import failing due to broken data
      </li>
      <li>
        <b>IMPORTANT:</b> The first row of the sheet will be ignored. Use it to
        describe the columns.
      </li>
    </ul>

    <FileForm intent={"backup"} />
  </>
);

export const ImportContent = () => (
  <>
    <h3>Import your own content</h3>
    <p>
      Import your own content by placing it in the csv file. Here you can{" "}
      <Button variant="link" to="#">
        download our CSV template.
      </Button>{" "}
      Some important details about how this works:
    </p>
    <br />
    <ul className="list-inside list-disc">
      <li>
        You must use <b>;</b> as a delimiter in your csv file
      </li>
      <li>Each row represents a new asset that will be created</li>
      <li>
        Columns such as <b>category, location & custodian</b> represent just the
        name of the related entry. As an example, if you put the category{" "}
        <b>Laptops</b> we will look for an existing category with that name and
        link the asset to it. If it doesn't exist, we will create it.
      </li>
      <li>
        Columns such as <b>tags</b> represent the names of a collection of
        entries. To assign multiple tags, just seperate their names with comas.
        If the tag doesn't exist, we will create it.
      </li>
      <li>
        The content you are importing will <b>NOT</b> be merged with existing
        assets. A new asset will be created for each valid row in the sheet.
      </li>
      <li>
        <b>IMPORTANT:</b> The first row of the sheet will be ignored. Use it to
        describe the columns.
      </li>
      <li>
        If any of the data in the file is invalid, the whole import will fail
      </li>
    </ul>
    <FileForm intent={"content"} />
  </>
);

const FileForm = ({ intent }: { intent: string }) => {
  const formRef = useRef<HTMLFormElement>(null);
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);
  const isSuccessful = fetcher.data?.success;

  /** We use a controlled field for the file, because of the confirmation dialog we have.
   * That way we can disabled the confirmation dialog button until a file is selected
   */
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const handleFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event?.target?.files?.[0];
    if (selectedFile) {
      setSelectedFile(selectedFile);
    }
  };

  return (
    <fetcher.Form
      className="mt-4"
      method="post"
      ref={formRef}
      encType="multipart/form-data"
    >
      <Input
        type="file"
        name="file"
        label="Select a csv file"
        required
        onChange={handleFileSelect}
        accept=".csv"
      />
      <input type="hidden" name="intent" value={intent} />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button title={"Confirm asset import"} disabled={!selectedFile}>
            Confirm asset import
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm asset import</AlertDialogTitle>
            <AlertDialogDescription>
              By clicking import you agree that you have read the requirements
              and you understand the limitations and consiquences of using this
              feature.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {fetcher.data?.error ? (
            <div>
              <b className="text-red-500">{fetcher.data?.error?.message}</b>
              <p>
                <b>{fetcher.data?.error?.details?.code}</b>
              </p>
              <p>
                Please fix your CSV file and try again. If the issue persists,
                don't hesitate to get in touch with us.
              </p>
            </div>
          ) : null}

          {fetcher.data?.success ? (
            <div>
              <b className="text-green-500">Success!</b>
              <p>Your assets have been imported.</p>
            </div>
          ) : null}

          <AlertDialogFooter>
            {isSuccessful ? (
              <Button to="/assets" width="full">
                View your newly created assets
              </Button>
            ) : (
              <>
                <AlertDialogCancel asChild>
                  <Button variant="secondary">Cancel</Button>
                </AlertDialogCancel>
                <Button
                  type="submit"
                  onClick={() => {
                    // Because we use a Dialog the submit buttons is outside of the form so we submit using the fetcher directly
                    fetcher.submit(formRef.current);
                  }}
                  disabled={disabled}
                >
                  Import
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fetcher.Form>
  );
};
