/**
 * AssetCodePrintText
 *
 * The asset's resolved display code (QR id, SAM id, or barcode value) rendered
 * as plain text for the printed PDFs — the booking checklist and the audit
 * receipt. Pairs with `resolveDisplayCode` from `~/modules/barcode/display`,
 * which the PDF data helpers call server-side.
 *
 * Deliberately NOT `<AssetCodeBadge>`: that chip is built around a tooltip, and
 * paper has no hover. What the badge explains on hover — "the type your
 * workspace asked for wasn't available on this asset, so this is the QR id" —
 * is printed here as a caption under the value instead, because a picker
 * holding the sheet has no other way to learn it.
 *
 * Renders nothing when there is no resolved code. Defensive: every asset has a
 * QR fallback, so this only happens if a caller omits the map entry.
 */

import type { ResolvedDisplayCode } from "~/modules/barcode/display";
import { labelForPreference } from "~/modules/barcode/display";

/**
 * Renders one asset's display code as a printable line, with a caption naming
 * the code's type when it is not the type the workspace asked for.
 *
 * @param props.displayCode - The `ResolvedDisplayCode` this row read out of the
 *   PDF's display-code map, or `undefined` when the map has no entry for it.
 * @returns The code line, or `null` when there is no code to print.
 */
export function AssetCodePrintText({
  displayCode,
}: {
  /** The entry this asset's row read out of the PDF's display-code map. */
  displayCode: ResolvedDisplayCode | undefined;
}) {
  if (!displayCode?.value) {
    return null;
  }

  return (
    <div className="flex flex-col items-start gap-0.5">
      <span className="break-all font-mono text-sm font-medium text-gray-900">
        {displayCode.value}
      </span>
      {displayCode.isFallback ? (
        <span className="text-[10px] text-gray-500">
          {labelForPreference(displayCode.type)}
        </span>
      ) : null}
    </div>
  );
}
