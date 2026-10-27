/**
 * Identifiers line for a scanned asset row.
 *
 * Titles are not unique: a workspace can hold dozens of assets called
 * "Camera" or "Asset 2", and a long scan list of them is unreadable without
 * something to tell the rows apart. This line names each row by the two
 * values an operator can check against the physical item: the asset's ID
 * (`sequentialId`, e.g. SAM-0042) and the code that was actually scanned.
 *
 * Used by every booking scanner drawer so a scanned row reads the same on
 * Scan to Assign and on Check Out.
 *
 * @see {@link file://./uses/add-assets-to-booking-drawer.tsx}
 * @see {@link file://./uses/fulfil-reservations-drawer.tsx}
 */

/** Props for {@link ScannedAssetIdentifiers}. */
type ScannedAssetIdentifiersProps = {
  /** The asset's ID, or null for an asset that has none yet. */
  sequentialId: string | null | undefined;
  /** The code the operator scanned: a QR id, a barcode value or an asset ID. */
  scannedCode: string;
};

/**
 * Renders the asset ID and the scanned code, separated by a dot.
 *
 * The scanned code is left out when it IS the asset ID (the operator scanned
 * or typed the ID itself), so the line never repeats one value twice.
 *
 * @param props - See {@link ScannedAssetIdentifiersProps}.
 * @returns The identifiers line, or null when there is nothing to show.
 */
export function ScannedAssetIdentifiers({
  sequentialId,
  scannedCode,
}: ScannedAssetIdentifiersProps) {
  // Scanning by asset ID resolves through the same endpoint, so the scanned
  // code can be the ID in any case the operator typed it in.
  const scannedTheId =
    !!sequentialId && scannedCode.toUpperCase() === sequentialId.toUpperCase();
  const parts = [
    sequentialId ? { label: "ID", value: sequentialId } : null,
    scannedTheId ? null : { label: "Scanned", value: scannedCode },
  ].filter((part) => part !== null);

  if (parts.length === 0) {
    return null;
  }

  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-gray-600">
      {parts.map((part, index) => (
        <span key={part.label} className="inline-flex items-center gap-1.5">
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <span>
            {part.label}{" "}
            <span className="font-mono text-gray-800">{part.value}</span>
          </span>
        </span>
      ))}
    </p>
  );
}
