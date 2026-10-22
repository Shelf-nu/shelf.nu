/**
 * @file Content import page body.
 *
 * Renders the import instructions (CSV rules, custom fields, QR codes,
 * barcodes, quantity-tracked columns) followed by the upload, preview and
 * confirm flow. Confirming queues a background import and leaves this page for
 * its progress view.
 *
 * One import runs per workspace at a time. While one is queued or running the
 * page shows its live progress at the top and holds the upload form; both
 * clear as soon as the polled status reaches COMPLETED or FAILED.
 *
 * @see {@link file://./flow.tsx} Upload, preview and confirm stages
 * @see {@link file://./../../../routes/_layout+/assets.import.tsx} Route handler
 */
import { formatCount } from "~/modules/asset-import/format";
import type { AssetImportStatusPayload } from "~/modules/asset-import/types";
import { useBarcodePermissions } from "~/utils/permissions/use-barcode-permissions";
import { ContentImportFlow } from "./flow";
import { isActiveStatus, useAssetImportStatus } from "./import-progress";
import Icon from "../../icons/icon";
import { Button } from "../../shared/button";
import When from "../../when/when";

/** Props for {@link ImportContent}. */
type ImportContentProps = {
  /** The workspace's QUEUED or RUNNING import from the loader, if any. */
  runningImport: AssetImportStatusPayload | null;
};

/**
 * Main content component for the CSV asset import page. Displays
 * instructions, rules and the upload flow, held while another import runs.
 *
 * @param props - See {@link ImportContentProps}
 */
export const ImportContent = ({ runningImport }: ImportContentProps) =>
  runningImport ? (
    <ImportContentWithRunningImport runningImport={runningImport} />
  ) : (
    <ImportContentBody runningStatus={null} />
  );

/**
 * Follows the running import and passes its live status down while it is
 * still active. Split out so polling only runs when there is an import.
 *
 * @param props.runningImport - The import from the loader
 */
function ImportContentWithRunningImport({
  runningImport,
}: {
  runningImport: AssetImportStatusPayload;
}) {
  const status = useAssetImportStatus(runningImport.id, runningImport);
  return (
    <ImportContentBody
      runningStatus={isActiveStatus(status.status) ? status : null}
    />
  );
}

/**
 * Notice that another import is running, with a link to its progress page.
 * Not a live region: the count changes on every poll.
 *
 * @param props.status - Live status of the running import
 */
function RunningImportBox({ status }: { status: AssetImportStatusPayload }) {
  return (
    <div className="my-4 flex flex-col gap-3 rounded border border-primary-200 bg-primary-25 p-3 text-sm text-primary-700 sm:flex-row sm:items-center sm:justify-between">
      <p>
        An import is running ({formatCount(status.processedRows)} of{" "}
        {formatCount(status.totalRows)}). You can upload another file when it
        finishes.
      </p>
      <Button
        to={`/assets/import/${status.id}`}
        variant="secondary"
        size="xs"
        className="shrink-0"
      >
        View progress
      </Button>
    </div>
  );
}

/**
 * The page body.
 *
 * @param props.runningStatus - Live status of an active import that holds the
 * upload form, or null when the form is open
 */
function ImportContentBody({
  runningStatus,
}: {
  runningStatus: AssetImportStatusPayload | null;
}) {
  const { canUseBarcodes } = useBarcodePermissions();

  return (
    <div className="w-full text-left">
      <h3>Import assets</h3>

      {runningStatus ? <RunningImportBox status={runningStatus} /> : null}

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
        - each row becomes a new asset.
      </p>

      <p className="my-4 text-[14px] text-gray-600">
        Already have a spreadsheet from another tool? Upload it as it is.
        Before anything is imported, you will check how each of its columns
        maps to a Shelf field.
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
                represent the name of the related entry - if it doesn't exist,
                we'll create it
              </li>
              <li>
                <b>Tags</b> can be comma-separated - missing tags will be
                created automatically
              </li>
              <li>
                Each row creates a <b>new</b> asset - existing assets will not
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
                <b>date</b> - must be YYYY-MM-DD
              </li>
              <li>
                <b>amount</b> - currency values, no symbols (e.g., 1234.56)
              </li>
              <li>
                <b>number</b> - numeric values including negatives
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
                <b>Existing code</b> - the QR code must already exist in Shelf
              </li>
              <li>
                <b>No duplicates</b> - each qrId must be unique per asset
              </li>
              <li>
                <b>No linked codes</b> - the qrId must not already be linked to
                another asset or kit
              </li>
              <li>
                <b>QR ownership</b> - the code must be unclaimed or belong to
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
                  <b>barcode_Code128</b> - 4-40 characters, supports letters,
                  numbers, and symbols
                </li>
                <li>
                  <b>barcode_Code39</b> - 4-43 characters
                </li>
                <li>
                  <b>barcode_DataMatrix</b> - 4-100 characters
                </li>
                <li>
                  <b>barcode_ExternalQR</b> - 1-2048 characters (URLs, text, or
                  any external QR content)
                </li>
                <li>
                  <b>barcode_EAN13</b> - 13-digit product identification codes
                </li>
              </ul>
              <p className="mt-1 text-[14px] text-gray-600">
                <b>Rules:</b> Use comma separation for multiple barcodes of the
                same type (e.g., "ABC123,DEF456"). Each value must be unique in
                your organization. Code39 and DataMatrix allow only letters and
                numbers; Code128 supports most symbols. Values are automatically
                converted to uppercase. Leave barcode columns empty if you don't
                want to assign barcodes. Enter External QR values exactly as the
                label encodes them, including https://.
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
                <b>type</b> - <code>INDIVIDUAL</code> (the default if the column
                is missing or the cell is blank) or{" "}
                <code>QUANTITY_TRACKED</code>. On <b>update</b> imports, the
                cell is silently ignored - type cannot be changed once an asset
                exists.
              </li>
              <li>
                <b>quantity</b> - required, must be a positive integer when{" "}
                <code>type = QUANTITY_TRACKED</code>. Ignored on{" "}
                <code>INDIVIDUAL</code> rows.
              </li>
              <li>
                <b>minQuantity</b> - optional non-negative integer; sets the
                low-stock alert threshold. Ignored on <code>INDIVIDUAL</code>{" "}
                rows.
              </li>
              <li>
                <b>unitOfMeasure</b> - optional free-text label (e.g.{" "}
                <code>boxes</code>, <code>liters</code>, <code>kg</code>).
                Markdoc injection characters (<code>{"{"}</code>, <code>%</code>
                , <code>{"}"}</code>) are stripped.
              </li>
              <li>
                <b>consumptionType</b> - required when{" "}
                <code>type = QUANTITY_TRACKED</code>. <code>ONE_WAY</code>{" "}
                (consumed on checkout, no return) or <code>TWO_WAY</code>{" "}
                (returned with a consumption report). Ignored on{" "}
                <code>INDIVIDUAL</code> rows.
              </li>
              <li>
                <b>assetModel</b> - optional asset model name; created
                automatically (case-insensitive lookup) if it doesn't exist yet.{" "}
                <b>INDIVIDUAL rows only</b> - on a <code>QUANTITY_TRACKED</code>{" "}
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
                The first row is used as column headers - it won't be imported
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

      <ContentImportFlow uploadBlocked={!!runningStatus} />
    </div>
  );
}
