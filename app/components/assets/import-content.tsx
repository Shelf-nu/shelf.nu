import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { QRCodePerImportedAsset } from "~/modules/qr/service.server";
import type { action } from "~/routes/_layout+/assets.import";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import Input from "../forms/input";
import { CrispButton } from "../marketing/crisp";
import { Button } from "../shared/button";
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
import { WarningBox } from "../shared/warning-box";
import { Table, Td, Th, Tr } from "../table";

export const ImportBackup = () => (
  <>
    <h2>Import backup from different workspace</h2>
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
        to="/static/shelf.nu-example-asset-import-from-content.csv"
        target="_blank"
        download
      >
        download our CSV template.
      </Button>{" "}
    </p>
    <WarningBox className="my-4">
      <>
        <strong>IMPORTANT</strong>: Do not use data exported from asset backup
        to import assets. You must use the template provided above or you will
        get corrupted data.
      </>
    </WarningBox>
    <h4>Base rules and limitations</h4>
    <ul className="list-inside list-disc">
      <li>
        You must use <b>, (comma)</b> or <b>; (semicolon)</b> as a delimiter in
        your csv file
      </li>
      <li>Each row represents a new asset that will be created</li>
      <li>
        Columns such as <b>kit, category, location & custodian</b> represent
        just the name of the related entry. As an example, if you put the
        category <b>Laptops</b> we will look for an existing category with that
        name and link the asset to it. If it doesn't exist, we will create it.
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
    </ul>

    <h4 className="mt-2">Importing Custom fields</h4>
    <div>
      To import custom fields, prefix your column heading with <b>"cf: "</b>,{" "}
      <br />
      add the type followed by a coma from one of the allowed types:
      <ul className="list-inside list-disc pl-4">
        <li>
          <b>text</b> - default if no type is passed
        </li>
        <li>
          <b>boolean</b> - choose a yes or no value
        </li>
        <li>
          <b>option</b> - you dont have to have the options created, we create
          option(both the field and the option) while importing if the option
          doesnt exisit.
        </li>
        <li>
          <b>multiline text</b>
        </li>
        <li>
          <b>date</b> - must be in <b>mm/dd/yyyy</b> format
        </li>
      </ul>
      If no type is mentioned <b>"text"</b> is used as default type.
    </div>
    <div>
      This is how a sample header looks like for custom field with name{" "}
      <b>"purchase date"</b> and type <b>"date"</b> :{" "}
      <b>"cf:purchase date, type:date"</b>
    </div>

    <h4 className="mt-2">Importing with QR codes</h4>
    <div>
      You also have the option to se a Shelf QR code for each asset. This is
      very valuable if you already have Shelf QR codes printed and you want to
      link them to the assets you are importing.
      <br />
      This feature comes with the following limitations:
      <ul className="list-inside list-disc pl-4">
        <li>
          <b>Existing code</b> - the QR code needs to already exist in shelf
        </li>
        <li>
          <b>No duplicate codes</b> - the qrId needs to be unique for each asset
        </li>
        <li>
          <b>No linked codes</b> - the qrId needs not be linked to any asset or
          kit
        </li>
        <li>
          <b>QR ownership</b> - the QR code needs to be either unclaimed or
          belong to the organization you are trying to import it to.
        </li>
      </ul>
      If no <b>"qrId"</b> is used a new QR code will be generated.
      <br />
      If you are interesting in receiving some unclaimed or unlinked codes, feel
      free to get in touch with support and we can provide those for you.
    </div>

    <h4 className="mt-2">Extra considerations</h4>
    <ul className="list-inside list-disc">
      <li>
        The first row of the sheet will be ignored. Use it to describe the
        columns as in the example sheet.
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
  const disabled = isFormProcessing(state) || agreed !== "I AGREE";
  const isSuccessful = data && !data.error;

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
                  consequences of using this feature.
                </AlertDialogDescription>
                <Input
                  type="text"
                  label={"Confirmation"}
                  autoFocus
                  name="agree"
                  value={agreed}
                  onChange={(e) =>
                    setAgreed(e.target.value.toUpperCase() as any)
                  }
                  placeholder="I AGREE"
                  pattern="^I AGREE$" // We use a regex to make sure the user types the exact string
                  required
                  onKeyDown={(e) => {
                    if (e.key == "Enter") {
                      e.preventDefault();
                      // Because we use a Dialog the submit buttons is outside of the form so we submit using the fetcher directly
                      if (!disabled) {
                        fetcher.submit(formRef.current);
                      }
                    }
                  }}
                />
              </>
            ) : null}
          </AlertDialogHeader>
          {data?.error ? (
            <div>
              <h5 className="text-red-500">{data.error.title}</h5>
              <p className="text-red-500">{data.error.message}</p>
              {data?.error?.additionalData?.duplicateCodes ? (
                <BrokenQrCodesTable
                  title="Duplicate codes"
                  data={
                    data.error.additionalData
                      .duplicateCodes as QRCodePerImportedAsset[]
                  }
                />
              ) : null}
              {data?.error?.additionalData?.nonExistentCodes ? (
                <BrokenQrCodesTable
                  title="Non existent codes"
                  data={
                    data.error.additionalData
                      .nonExistentCodes as QRCodePerImportedAsset[]
                  }
                />
              ) : null}
              {data?.error?.additionalData?.linkedCodes ? (
                <BrokenQrCodesTable
                  title="Already linked codes"
                  data={
                    data.error.additionalData
                      .linkedCodes as QRCodePerImportedAsset[]
                  }
                />
              ) : null}
              {data?.error?.additionalData?.connectedToOtherOrgs ? (
                <BrokenQrCodesTable
                  title="Some codes do not belong to this organization"
                  data={
                    data.error.additionalData
                      .connectedToOtherOrgs as QRCodePerImportedAsset[]
                  }
                />
              ) : null}

              <p className="mt-2">
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
              <div className="flex gap-2">
                <AlertDialogCancel asChild>
                  <Button variant="secondary" width="full">
                    Close
                  </Button>
                </AlertDialogCancel>
                <Button to="/assets" width="full" className="whitespace-nowrap">
                  View new assets
                </Button>
              </div>
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

function BrokenQrCodesTable({
  title,
  data,
}: {
  title: string;
  data: QRCodePerImportedAsset[];
}) {
  return (
    <div className="mt-3">
      <h5>{title}</h5>
      <Table className="mt-1 [&_td]:p-1 [&_th]:p-1">
        <thead>
          <Tr>
            <Th>Asset title</Th>
            <Th>QR ID</Th>
          </Tr>
        </thead>
        <tbody>
          {data.map((code: { title: string; qrId: string }) => (
            <Tr key={code.title}>
              <Td>{code.title}</Td>
              <Td>{code.qrId}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
