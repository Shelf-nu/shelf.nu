import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { QRCodePerImportedAsset } from "~/modules/qr/service.server";
import type { action } from "~/routes/_layout+/assets.import";
import { isFormProcessing } from "~/utils/form";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import Input from "../forms/input";
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
import When from "../when/when";

export const ImportContent = () => {
  const { canUseBarcodes } = useBarcodePermissions();

  return (
    <div className="text-left">
      <h3>Import your own content</h3>
      <p>
        Import your own content by placing it in the csv file. Here you can{" "}
        <Button
          variant="link"
          to={
            canUseBarcodes
              ? "/static/shelf.nu-example-asset-import-from-content-with-barcodes.csv"
              : "/static/shelf.nu-example-asset-import-from-content.csv"
          }
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
          You must use <b>, (comma)</b> or <b>; (semicolon)</b> as a delimiter
          in your csv file
        </li>
        <li>Each row represents a new asset that will be created</li>
        <li>
          Columns such as <b>kit, category, location & custodian</b> represent
          just the name of the related entry. As an example, if you put the
          category <b>Laptops</b> we will look for an existing category with
          that name and link the asset to it. If it doesn't exist, we will
          create it.
        </li>
        <li>
          Columns such as <b>tags</b> represent the names of a collection of
          entries. To assign multiple tags, just seperate their names with
          comas. If the tag doesn't exist, we will create it.
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
            <b>date</b> - must be in <b>YYYY-MM-DD</b> format
          </li>
          <li>
            <b>amount</b> - for currency values (e.g., 1234.56 - no currency
            symbols)
          </li>
          <li>
            <b>number</b> - for numeric values including negatives (e.g.,
            -123.45)
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
            <b>No duplicate codes</b> - the qrId needs to be unique for each
            asset
          </li>
          <li>
            <b>No linked codes</b> - the qrId needs not be linked to any asset
            or kit
          </li>
          <li>
            <b>QR ownership</b> - the QR code needs to be either unclaimed or
            belong to the organization you are trying to import it to.
          </li>
        </ul>
        If no <b>"qrId"</b> is used a new QR code will be generated.
        <br />
        If you are interesting in receiving some unclaimed or unlinked codes,
        feel free to get in touch with support and we can provide those for you.
      </div>

      <When truthy={canUseBarcodes}>
        <h4 className="mt-2">Importing with Barcodes</h4>
        <div>
          You can also import assets with barcodes using the barcode columns.
          This feature supports three barcode types: <b>Code128</b>,{" "}
          <b>Code39</b>, and <b>DataMatrix</b>.
          <br />
          <br />
          <b>Barcode column format:</b>
          <ul className="list-inside list-disc pl-4">
            <li>
              <b>barcode_Code128</b> - For Code128 barcodes (4-40 characters,
              supports letters, numbers, and symbols like dashes)
            </li>
            <li>
              <b>barcode_Code39</b> - For Code39 barcodes (4-43 characters)
            </li>
            <li>
              <b>barcode_DataMatrix</b> - For DataMatrix barcodes (4-100
              characters)
            </li>
            <li>
              <b>barcode_ExternalQR</b> - For external QR codes (1-2048
              characters, URLs, text, or any external QR content)
            </li>
            <li>
              <b>barcode_EAN13</b> - For retail barcodes (13-digit product
              identification codes))
            </li>
          </ul>
          <br />
          <b>Important rules:</b>
          <ul className="list-inside list-disc pl-4">
            <li>
              <b>Multiple barcodes</b> - Use comma separation for multiple
              barcodes of the same type (e.g., "ABC123,DEF456")
            </li>
            <li>
              <b>Unique values</b> - Each barcode value must be unique within
              your organization
            </li>
            <li>
              <b>Character restrictions</b> - Code39 and DataMatrix allow only
              letters and numbers, Code128 supports most symbols
            </li>
            <li>
              <b>Case insensitive</b> - Values will be automatically converted
              to uppercase
            </li>
          </ul>
          Leave barcode columns empty if you don't want to assign barcodes to
          specific assets.
        </div>
      </When>

      <div>
        <h4 className="mt-2">Extra considerations</h4>
        <ul className="list-inside list-disc pl-4">
          <li>
            The first row of the sheet will be ignored. Use it to describe the
            columns as in the example sheet.
          </li>
          <li>
            If any of the data in the file is invalid, the whole import will
            fail
          </li>
        </ul>
      </div>

      <div className="mt-2 w-full">
        For more help, you can use our{" "}
        <Button
          variant="link"
          to="https://www.shelf.nu/csv-helper"
          target="_blank"
        >
          CSV Helper Tool
        </Button>
        .
      </div>

      <FileForm intent={"content"} />
    </div>
  );
};

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
      className="mt-4 w-full"
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
            className="my-4"
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

          <When truthy={!!data?.error}>
            <div className="overflow-y-scroll">
              <h5 className="text-red-500">{data?.error?.title}</h5>
              <p className="text-red-500">{data?.error?.message}</p>
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

              {Array.isArray(data?.error?.additionalData?.defectedHeaders) ? (
                <table className="mt-4 w-full rounded-md border text-left text-sm">
                  <thead className="bg-error-100 text-xs">
                    <tr>
                      <th scope="col" className="px-2 py-1">
                        Incorrect Header
                      </th>
                      <th scope="col" className="px-2 py-1">
                        Error
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.error?.additionalData?.defectedHeaders?.map(
                      (data: {
                        incorrectHeader: string;
                        errorMessage: string;
                      }) => (
                        <tr key={data.incorrectHeader}>
                          <td className="px-2 py-1">{data.incorrectHeader}</td>
                          <td className="px-2 py-1">{data.errorMessage}</td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              ) : null}

              <p className="mt-2">
                Please fix your CSV file and try again. If the issue persists,
                don't hesitate to get in touch with us.
              </p>
            </div>
          </When>

          <When truthy={isSuccessful}>
            <div>
              <b className="text-green-500">Success!</b>
              <p>Your assets have been imported.</p>
            </div>
          </When>

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
