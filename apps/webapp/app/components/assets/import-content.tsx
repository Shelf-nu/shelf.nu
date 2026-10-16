/**
 * @file Import content components for CSV asset import.
 * Provides the main ImportContent layout (instructions plus the two-step
 * mapping form), the shared "I AGREE" confirmation dialog, and FileForm, the
 * one-step upload the admin dashboard uses.
 *
 * @see {@link file://./../../routes/_layout+/assets.import.tsx} Route handler
 */
import type { ChangeEvent } from "react";
import { useRef, useState } from "react";
import { useAutoFocus } from "~/hooks/use-auto-focus";
import { useDisabled } from "~/hooks/use-disabled";
import useFetcherWithReset from "~/hooks/use-fetcher-with-reset";
import type { DuplicateBarcode } from "~/modules/barcode/service.server";
import type { QRCodePerImportedAsset } from "~/modules/qr/service.server";
import type { action } from "~/routes/_layout+/assets.import";
import { readImportRowErrors } from "~/utils/import-row-errors";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import Input from "../forms/input";
import Icon from "../icons/icon";
import { Button } from "../shared/button";
import { ImportRowErrorsTable } from "../shared/import-row-errors-table";
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
import { Table, Td, Th, Tr } from "../table";
import { MappingImportForm } from "./import-mapping/mapping-import-form";
import When from "../when/when";

/**
 * Main content component for the CSV asset import page.
 * Displays instructions, rules, and embeds the FileForm for upload.
 */
export const ImportContent = () => {
  const { canUseBarcodes } = useBarcodePermissions();

  return (
    <div className="w-full text-left">
      <h3>Import assets</h3>

      {/* Intent fork */}
      <div className="my-4 flex gap-3 rounded-md border border-gray-200 bg-gray-50 p-4">
        <Icon
          icon="switch"
          size="xs"
          className="mt-0.5 shrink-0 text-gray-500"
        />
        <p className="text-[14px] text-gray-600">
          <b>Want to update existing assets instead?</b> If you've exported
          assets from the Asset Index and made changes in Excel, you can
          re-import them to bulk update.{" "}
          <Button variant="link" to="/assets/import-update">
            Go to bulk update →
          </Button>
        </p>
      </div>

      <h4>Create new assets from CSV</h4>
      <p>
        Upload a CSV file to create new assets. Start with our{" "}
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
          CSV template
        </Button>{" "}
        — each row becomes a new asset.
      </p>

      <p className="my-4 text-[14px] text-gray-600">
        Already have a spreadsheet from another tool? Upload it as it is. Before
        anything is imported, you will check how each of its columns maps to a
        Shelf field.
      </p>

      <div className="my-5 flex flex-col gap-4">
        {/* Base rules */}
        <div className="flex gap-3">
          <Icon
            icon="write"
            size="xs"
            className="mt-0.5 shrink-0 text-gray-500"
          />
          <div>
            <h5 className="font-semibold">Base rules</h5>
            <ul className="list-inside list-disc text-[14px] text-gray-600">
              <li>
                Use <b>, (comma)</b> or <b>; (semicolon)</b> as delimiter
              </li>
              <li>
                Columns like <b>kit, category, location & custodian</b>{" "}
                represent the name of the related entry — if it doesn't exist,
                we'll create it
              </li>
              <li>
                <b>Tags</b> can be comma-separated — missing tags will be
                created automatically
              </li>
              <li>
                Each row creates a <b>new</b> asset — existing assets will not
                be merged or overwritten
              </li>
              <li>
                To onboard stock-room consumables (boxes, batteries, fasteners),
                or to link items to a reusable asset model, see{" "}
                <b>"Quantity-tracked assets"</b> below
              </li>
            </ul>
          </div>
        </div>

        {/* Custom fields */}
        <div className="flex gap-3">
          <Icon
            icon="settings"
            size="xs"
            className="mt-0.5 shrink-0 text-gray-500"
          />
          <div>
            <h5 className="font-semibold">Custom fields</h5>
            <p className="text-[14px] text-gray-600">
              Prefix your column heading with <b>"cf: "</b> and add the type
              after a comma. Supported types:
            </p>
            <ul className="list-inside list-disc pl-2 text-[14px] text-gray-600">
              <li>
                <b>text</b> (default), <b>boolean</b>, <b>option</b>,{" "}
                <b>multiline text</b>
              </li>
              <li>
                <b>date</b> — must be YYYY-MM-DD
              </li>
              <li>
                <b>amount</b> — currency values, no symbols (e.g., 1234.56)
              </li>
              <li>
                <b>number</b> — numeric values including negatives
              </li>
            </ul>
            <p className="mt-1 text-[14px] text-gray-600">
              Example header: <b>"cf:purchase date, type:date"</b>
            </p>
          </div>
        </div>

        {/* QR codes */}
        <div className="flex gap-3">
          <Icon
            icon="scanQR"
            size="xs"
            className="mt-0.5 shrink-0 text-gray-500"
          />
          <div>
            <h5 className="font-semibold">QR codes</h5>
            <p className="text-[14px] text-gray-600">
              You can link a Shelf QR code to each asset. This is useful if you
              already have QR codes printed and want to connect them to the
              assets you're importing. Limitations:
            </p>
            <ul className="list-inside list-disc pl-2 text-[14px] text-gray-600">
              <li>
                <b>Existing code</b> — the QR code must already exist in Shelf
              </li>
              <li>
                <b>No duplicates</b> — each qrId must be unique per asset
              </li>
              <li>
                <b>No linked codes</b> — the qrId must not already be linked to
                another asset or kit
              </li>
              <li>
                <b>QR ownership</b> — the code must be unclaimed or belong to
                your organization
              </li>
            </ul>
            <p className="mt-1 text-[14px] text-gray-600">
              If no <b>"qrId"</b> is provided, a new QR code will be generated.
              Need unclaimed or unlinked codes? Contact support and we can
              provide them.
            </p>
          </div>
        </div>

        {/* Barcodes */}
        <When truthy={canUseBarcodes}>
          <div className="flex gap-3">
            <Icon
              icon="barcode"
              size="xs"
              className="mt-0.5 shrink-0 text-gray-500"
            />
            <div>
              <h5 className="font-semibold">Barcodes</h5>
              <p className="text-[14px] text-gray-600">
                Import assets with barcodes using these columns:
              </p>
              <ul className="list-inside list-disc pl-2 text-[14px] text-gray-600">
                <li>
                  <b>barcode_Code128</b> — 4-40 characters, supports letters,
                  numbers, and symbols
                </li>
                <li>
                  <b>barcode_Code39</b> — 4-43 characters
                </li>
                <li>
                  <b>barcode_DataMatrix</b> — 4-100 characters
                </li>
                <li>
                  <b>barcode_ExternalQR</b> — 1-2048 characters (URLs, text, or
                  any external QR content)
                </li>
                <li>
                  <b>barcode_EAN13</b> — 13-digit product identification codes
                </li>
              </ul>
              <p className="mt-1 text-[14px] text-gray-600">
                <b>Rules:</b> Use comma separation for multiple barcodes of the
                same type (e.g., "ABC123,DEF456"). Each value must be unique in
                your organization. Code39 and DataMatrix allow only letters and
                numbers; Code128 supports most symbols. Values are automatically
                converted to uppercase. Leave barcode columns empty if you don't
                want to assign barcodes.
              </p>
            </div>
          </div>
        </When>

        {/* Quantity-tracked assets + asset model columns */}
        <div className="flex gap-3">
          <Icon
            icon="asset"
            size="xs"
            className="mt-0.5 shrink-0 text-gray-500"
          />
          <div>
            <h5 className="font-semibold">Quantity-tracked assets</h5>
            <p className="text-[14px] text-gray-600">
              Six optional columns let you onboard stock-room consumables
              (boxes, batteries, fasteners) and link individually-tracked assets
              to a reusable asset model:
            </p>
            <ul className="list-inside list-disc pl-2 text-[14px] text-gray-600">
              <li>
                <b>type</b> — <code>INDIVIDUAL</code> (the default if the column
                is missing or the cell is blank) or{" "}
                <code>QUANTITY_TRACKED</code>. On <b>update</b> imports, the
                cell is silently ignored — type cannot be changed once an asset
                exists.
              </li>
              <li>
                <b>quantity</b> — required, must be a positive integer when{" "}
                <code>type = QUANTITY_TRACKED</code>. Ignored on{" "}
                <code>INDIVIDUAL</code> rows.
              </li>
              <li>
                <b>minQuantity</b> — optional non-negative integer; sets the
                low-stock alert threshold. Ignored on <code>INDIVIDUAL</code>{" "}
                rows.
              </li>
              <li>
                <b>unitOfMeasure</b> — optional free-text label (e.g.{" "}
                <code>boxes</code>, <code>liters</code>, <code>kg</code>).
                Markdoc injection characters (<code>{"{"}</code>, <code>%</code>
                , <code>{"}"}</code>) are stripped.
              </li>
              <li>
                <b>consumptionType</b> — required when{" "}
                <code>type = QUANTITY_TRACKED</code>. <code>ONE_WAY</code>{" "}
                (consumed on checkout, no return) or <code>TWO_WAY</code>{" "}
                (returned with a consumption report). Ignored on{" "}
                <code>INDIVIDUAL</code> rows.
              </li>
              <li>
                <b>assetModel</b> — optional asset model name; created
                automatically (case-insensitive lookup) if it doesn't exist yet.{" "}
                <b>INDIVIDUAL rows only</b> — on a <code>QUANTITY_TRACKED</code>{" "}
                row during update, the cell is skipped with a warning and the
                rest of the row still applies.
              </li>
            </ul>
            <p className="mt-1 text-[14px] text-gray-600">
              <b>Tip:</b> the downloaded template above already contains one{" "}
              <code>INDIVIDUAL</code> example with an <code>assetModel</code>{" "}
              and one <code>QUANTITY_TRACKED</code> example with{" "}
              <code>quantity</code> and <code>consumptionType</code> filled in.
            </p>
          </div>
        </div>

        {/* Extra considerations */}
        <div className="flex gap-3">
          <Icon
            icon="question"
            size="xs"
            className="mt-0.5 shrink-0 text-gray-500"
          />
          <div>
            <h5 className="font-semibold">Good to know</h5>
            <ul className="list-inside list-disc text-[14px] text-gray-600">
              <li>
                The first row is used as column headers — it won't be imported
              </li>
              <li>
                Your file is checked before anything is imported. If any row is
                invalid, nothing is created and you'll get a list of every
                problem to fix
              </li>
            </ul>
          </div>
        </div>
      </div>

      <p className="text-[14px] text-gray-500">
        Need help preparing your file? Try our{" "}
        <Button
          variant="link"
          to="https://www.shelf.nu/csv-helper"
          target="_blank"
        >
          CSV Helper Tool
        </Button>
        .
      </p>

      <MappingImportForm />
    </div>
  );
};

/** The fetcher that posts the import, typed by the import route's action. */
export type ImportFetcher = ReturnType<
  typeof useFetcherWithReset<typeof action>
>;

/**
 * The "I AGREE" confirmation dialog of the asset import, with the importer's
 * error tables and the success state.
 *
 * @param props.fetcher - The fetcher whose response the dialog shows
 * @param props.onSubmit - Posts the import; called once the user agrees
 * @param props.triggerDisabled - Disables the button that opens the dialog
 * @param props.triggerLabel - Text of that button
 */
export function ImportConfirmDialog({
  fetcher,
  onSubmit,
  triggerDisabled,
  triggerLabel = "Confirm asset import",
}: {
  fetcher: ImportFetcher;
  onSubmit: () => void;
  triggerDisabled: boolean;
  triggerLabel?: string;
}) {
  // Widened to `string` so toUpperCase() doesn't need a cast.
  // The "I AGREE" check happens at submit time.
  const [agreed, setAgreed] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const { data } = fetcher;
  const isSubmitting = useDisabled(fetcher);
  const disabled = isSubmitting || agreed !== "I AGREE";
  const isSuccessful = data && !data.error;

  /** Row-level import problems, narrowed out of the error payload. */
  const { rowErrors, totalRowErrors } = readImportRowErrors(
    data?.error?.additionalData
  );

  // Focus the "I AGREE" confirmation input when the dialog opens (replaces
  // `autoFocus`). Re-focuses each time the dialog re-opens; skipped while
  // the success state is showing.
  const agreeInputRef = useAutoFocus<HTMLInputElement>({
    when: isDialogOpen && !isSuccessful,
  });

  return (
    <AlertDialog
      onOpenChange={(open) => {
        setIsDialogOpen(open);
        if (!open) {
          // Reset form state when dialog is closed
          setAgreed("");
          fetcher.reset();
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          title={triggerLabel}
          disabled={triggerDisabled}
          className="my-4"
        >
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-[600px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm asset import</AlertDialogTitle>
          {!isSuccessful ? (
            <>
              <AlertDialogDescription>
                You need to type: <b>"I AGREE"</b> in the field below to accept
                the import. By doing this you agree that you have read the
                requirements and you understand the limitations and consequences
                of using this feature.
              </AlertDialogDescription>
              <Input
                type="text"
                label={"Confirmation"}
                ref={agreeInputRef}
                name="agree"
                value={agreed}
                onChange={(e) => setAgreed(e.target.value.toUpperCase())}
                placeholder="I AGREE"
                pattern="^I AGREE$" // We use a regex to make sure the user types the exact string
                required
                onKeyDown={(e) => {
                  if (e.key == "Enter") {
                    e.preventDefault();
                    // Because we use a Dialog the submit buttons is outside of the form so we submit using the fetcher directly
                    if (!disabled) {
                      onSubmit();
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

            {data?.error?.additionalData?.duplicateBarcodes ? (
              <DuplicateBarcodesTable
                data={
                  data.error.additionalData
                    .duplicateBarcodes as DuplicateBarcode[]
                }
              />
            ) : null}

            {data?.error?.additionalData?.kitCustodyConflicts ? (
              <table className="mt-4 w-full rounded-md border text-left text-sm">
                <thead className="bg-error-100 text-xs">
                  <tr>
                    <th scope="col" className="px-2 py-1">
                      Asset
                    </th>
                    <th scope="col" className="px-2 py-1">
                      Custodian
                    </th>
                    <th scope="col" className="px-2 py-1">
                      Kit
                    </th>
                    <th scope="col" className="px-2 py-1">
                      Issue
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    data.error.additionalData.kitCustodyConflicts as Array<{
                      asset: string;
                      custodian: string;
                      kit: string;
                      issue: string;
                    }>
                  ).map((conflict) => (
                    <tr
                      // Compose a stable key from the conflict fields —
                      // the backend can surface the same asset twice
                      // for different issues, so include `issue` too.
                      key={`${conflict.asset}-${conflict.kit}-${conflict.custodian}-${conflict.issue}`}
                      className="border-b"
                    >
                      <td className="px-2 py-1">{conflict.asset}</td>
                      <td className="px-2 py-1">{conflict.custodian}</td>
                      <td className="px-2 py-1">{conflict.kit}</td>
                      <td className="px-2 py-1">{conflict.issue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

            {rowErrors ? (
              <ImportRowErrorsTable
                rowErrors={rowErrors}
                totalRowErrors={totalRowErrors}
              />
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
                <Button type="button" variant="secondary" width="full">
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
                <Button type="button" variant="secondary">
                  Cancel
                </Button>
              </AlertDialogCancel>
              <Button
                type="submit"
                onClick={() => {
                  // Because we use a Dialog the submit buttons is outside of the form so we submit using the fetcher directly
                  onSubmit();
                }}
                disabled={disabled}
              >
                {isSubmitting ? "Importing..." : "Import"}
              </Button>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * File upload form with confirmation dialog for CSV asset import, used by the
 * admin dashboard. Posts the file as-is, without a column mapping.
 *
 * @param intent - The form intent value sent to the action
 */
export const FileForm = ({ intent }: { intent: string }) => {
  const formRef = useRef<HTMLFormElement>(null);
  const fetcher = useFetcherWithReset<typeof action>();

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

      <ImportConfirmDialog
        fetcher={fetcher}
        triggerDisabled={!selectedFile}
        onSubmit={() => {
          // The dialog's buttons sit outside the form, so submit through the fetcher.
          void fetcher.submit(formRef.current);
        }}
      />
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

function DuplicateBarcodesTable({ data }: { data: DuplicateBarcode[] }) {
  return (
    <div className="mt-3">
      <h5>Duplicate barcodes</h5>
      <Table className="mt-1 [&_td]:p-1 [&_th]:p-1">
        <thead>
          <Tr>
            <Th>Barcode</Th>
            <Th>Used by assets</Th>
          </Tr>
        </thead>
        <tbody>
          {data.map((barcode) => (
            <Tr key={barcode.value}>
              <Td className="align-top">{barcode.value}</Td>
              <Td className="whitespace-normal">
                <ul className="list-disc pl-4">
                  {barcode.assets.map((asset) => (
                    // CSV `row` number is unique per imported asset
                    // within a single error payload, so it's a stable
                    // key (include title+type to be extra safe if the
                    // same row ever surfaces under multiple barcodes).
                    <li key={`${asset.row}-${asset.type}-${asset.title}`}>
                      {asset.title} ({asset.type}): Line {asset.row}
                    </li>
                  ))}
                </ul>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
