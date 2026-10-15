/**
 * @file Error block shown when a CSV import is refused.
 *
 * Renders the error title and message followed by every table of problems the
 * server can attach to an import error: QR code conflicts, duplicate barcodes,
 * kit custody conflicts, incorrect headers and per-row errors. Used by the
 * admin upload dialog and by the preview stage of the content import.
 *
 * @see {@link file://./../import-content-file-form.tsx} Admin upload dialog consumer
 * @see {@link file://./../../../utils/import-row-errors.ts} Row error shape
 */
import type { DuplicateBarcode } from "~/modules/barcode/service.server";
import type { QRCodePerImportedAsset } from "~/modules/qr/service.server";
import { readImportRowErrors } from "~/utils/import-row-errors";
import { ImportRowErrorsTable } from "../../shared/import-row-errors-table";
import { Table, Td, Th, Tr } from "../../table";

/** A kit custody conflict reported by the import pre-flight checks. */
type KitCustodyConflict = {
  asset: string;
  custodian: string;
  kit: string;
  issue: string;
};

/** A CSV header the importer could not interpret. */
type DefectedHeader = { incorrectHeader: string; errorMessage: string };

/** Props for {@link ImportErrorDetails}. */
type ImportErrorDetailsProps = {
  error: {
    title?: string;
    message: string;
    /** Untyped payload of the server error. Its members are narrowed before use. */
    additionalData?: unknown;
  };
};

/**
 * Renders an import error and every problem table its `additionalData` carries.
 *
 * @param props.error - The error payload returned by an import action
 * @returns The error block, ending with the "fix your CSV" footer
 */
export function ImportErrorDetails({ error }: ImportErrorDetailsProps) {
  const additionalData =
    error.additionalData && typeof error.additionalData === "object"
      ? (error.additionalData as Record<string, unknown>)
      : {};
  const { rowErrors, totalRowErrors } = readImportRowErrors(additionalData);

  return (
    <div className="overflow-y-scroll">
      <h5 className="text-red-500">{error.title}</h5>
      <p className="text-red-500">{error.message}</p>
      {additionalData.duplicateCodes ? (
        <BrokenQrCodesTable
          title="Duplicate codes"
          data={additionalData.duplicateCodes as QRCodePerImportedAsset[]}
        />
      ) : null}
      {additionalData.nonExistentCodes ? (
        <BrokenQrCodesTable
          title="Non existent codes"
          data={additionalData.nonExistentCodes as QRCodePerImportedAsset[]}
        />
      ) : null}
      {additionalData.linkedCodes ? (
        <BrokenQrCodesTable
          title="Already linked codes"
          data={additionalData.linkedCodes as QRCodePerImportedAsset[]}
        />
      ) : null}
      {additionalData.connectedToOtherOrgs ? (
        <BrokenQrCodesTable
          title="Some codes do not belong to this workspace"
          data={additionalData.connectedToOtherOrgs as QRCodePerImportedAsset[]}
        />
      ) : null}

      {additionalData.duplicateBarcodes ? (
        <DuplicateBarcodesTable
          data={additionalData.duplicateBarcodes as DuplicateBarcode[]}
        />
      ) : null}

      {additionalData.kitCustodyConflicts ? (
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
            {(additionalData.kitCustodyConflicts as KitCustodyConflict[]).map(
              (conflict) => (
                <tr
                  // Compose a stable key from the conflict fields: the backend
                  // can surface the same asset twice for different issues, so
                  // `issue` is part of the key.
                  key={`${conflict.asset}-${conflict.kit}-${conflict.custodian}-${conflict.issue}`}
                  className="border-b"
                >
                  <td className="px-2 py-1">{conflict.asset}</td>
                  <td className="px-2 py-1">{conflict.custodian}</td>
                  <td className="px-2 py-1">{conflict.kit}</td>
                  <td className="px-2 py-1">{conflict.issue}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      ) : null}

      {Array.isArray(additionalData.defectedHeaders) ? (
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
            {(additionalData.defectedHeaders as DefectedHeader[]).map(
              (header) => (
                <tr key={header.incorrectHeader}>
                  <td className="px-2 py-1">{header.incorrectHeader}</td>
                  <td className="px-2 py-1">{header.errorMessage}</td>
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
        Please fix your CSV file and try again. If the issue persists, don't
        hesitate to get in touch with us.
      </p>
    </div>
  );
}

/**
 * Table of imported assets whose QR code is unusable.
 *
 * @param props.title - Heading naming the kind of conflict
 * @param props.data - The offending assets with their QR IDs
 */
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

/**
 * Table of barcode values used by more than one imported asset.
 *
 * @param props.data - Each duplicated barcode with the rows that use it
 */
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
                    // The CSV `row` number is unique per imported asset within
                    // one error payload; title and type guard the case where
                    // the same row surfaces under several barcodes.
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
