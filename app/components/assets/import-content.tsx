import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { action } from "~/routes/_layout+/assets.import";
import { isFormProcessing, tw } from "~/utils";
import Input from "../forms/input";
import { CrispButton } from "../marketing/crisp";
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

export const ImportBackup = () => (
  <>
    <h3>Import backup from different workspace</h3>
    <p>
      Currently this feature is provided as a service to shelf.nu users. If you
      are interested{" "}
      <CrispButton className={tw()} variant="link" title="Get in touch">
        get in touch
      </CrispButton>{" "}
      with us and we will migrate your data for you.
    </p>
  </>
);

export const ImportContent = () => (
  <>
    <h3>Import your own content</h3>
    <p>
      Import your own content by placing it in the csv file. Here you can{" "}
      <Button
        variant="link"
        to="/shelf.nu-example-asset-import-from-content.csv"
        target="_blank"
        download
      >
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
        To import custom fields, prefix your column heading with <b>"cf: "</b>,
        add the type followed by a coma from one of the allowed types(
        <b>"text", "boolean", "option", "multiline text", "date"</b>).
        <br /> this is how a sample header looks like for custom type with name{" "}
        <b>"purchase date"</b> and type <b>"date"</b> :{" "}
        <b>"cf:purchase date, type:date"</b>
        <br /> if no type is mentioned "text" is used as default type.
        <br /> date can be in <b>mm-dd-yyyy</b> or <b>dd-mon-yyyy</b> format.
        <br /> in case of options, you dont have to have the options created, we
        create option(both the field and the option) while importing if the
        option doesnt exisit.
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

export const FileForm = ({ intent, url }: { intent: string; url?: string }) => {
  const [agreed, setAgreed] = useState<"I AGREE" | "">("");
  const formRef = useRef<HTMLFormElement>(null);
  const fetcher = useFetcher<typeof action>();

  const { data, state } = fetcher;
  // const isSuccessFull = state === "idle" && data != null && !data?.error;
  const disabled = isFormProcessing(state) || agreed !== "I AGREE";
  const isSuccessful = data?.success;

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
      action={url ? url : undefined}
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
          <Button
            title={"Confirm asset import"}
            disabled={!selectedFile}
            className="mt-4"
          >
            Confirm asset import
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm asset import</AlertDialogTitle>
            {!isSuccessful ? (
              <>
                <AlertDialogDescription>
                  You need to type: <b>"I AGREE"</b> in the field below to
                  accept the import. By doing this you agree that you have read
                  the requirements and you understand the limitations and
                  consiquences of using this feature.
                </AlertDialogDescription>
                <Input
                  type="text"
                  label={"Confirmation"}
                  name="agree"
                  value={agreed}
                  onChange={(e) => setAgreed(e.target.value as any)}
                  placeholder="I AGREE"
                  pattern="^I AGREE$" // We use a regex to make sure the user types the exact string
                  required
                />
              </>
            ) : null}
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

          {isSuccessful ? (
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
                  {isFormProcessing(fetcher.state) ? "Importing..." : "Import"}
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </fetcher.Form>
  );
};
