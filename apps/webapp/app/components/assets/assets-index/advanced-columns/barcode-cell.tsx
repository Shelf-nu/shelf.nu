/**
 * BarcodeCell
 *
 * Renders one of the per-type barcode columns (`barcode_Code128`,
 * `barcode_Code39`, `barcode_DataMatrix`, `barcode_ExternalQR`,
 * `barcode_EAN13`) in the advanced asset table. Each chip is wrapped in a
 * native button so clicking opens the `CodePreviewDialog`, matching
 * `QrIdCell` / `SamIdCell`.
 *
 * An asset can carry an unbounded number of barcodes of a single type. The
 * cell shows at most `MAX_VISIBLE_BARCODES` chips on ONE line and collapses
 * the rest behind a `+N` badge — the same overflow convention the tags column
 * gets from `ItemsWithViewMore`. The single line is a hard layout requirement:
 * a cell sets the height of its row, so a wrapping chip container stretches
 * every other column in that row along with it.
 *
 * The `+N` badge is a dialog trigger rather than the tooltip-only badge
 * `ItemsWithViewMore` renders, because these chips are interactive — Radix
 * tooltip content is not, so hiding clickable chips inside one would drop the
 * click-to-preview affordance for the overflow. Hover or keyboard focus still
 * lists the hidden values as text.
 *
 * @see {@link file://./qr-id-cell.tsx}
 * @see {@link file://../../../list/items-with-view-more.tsx}
 */

import type { QrIdDisplayPreference } from "@prisma/client";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { CodePreviewDialog } from "~/components/code-preview/code-preview-dialog";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import type { BarcodeField } from "~/modules/asset-index-settings/helpers";
import { Td } from "./td";

/**
 * How many barcode chips render inline before the rest collapse into `+N`.
 * Matches the `showCount={2}` the tags column passes to `ItemsWithViewMore`,
 * so both overflow columns truncate at the same point.
 */
const MAX_VISIBLE_BARCODES = 2;

/** Shared focus-ring styling for the chip and overflow click targets. */
const TRIGGER_CLASSES =
  "rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1";

type BarcodeCellProps = {
  column: BarcodeField;
  item: AdvancedIndexAsset;
  workspacePreference: QrIdDisplayPreference;
};

type ItemBarcode = NonNullable<AdvancedIndexAsset["barcodes"]>[number];

/**
 * Renders the barcode column cell for a single barcode type.
 *
 * @param column - The barcode column being rendered (`barcode_<Type>`)
 * @param item - The advanced-index asset row
 * @param workspacePreference - Org's preferred display code, passed to the chip
 * @returns A `<Td>` with up to `MAX_VISIBLE_BARCODES` chips plus `+N` overflow
 */
export function BarcodeCell({
  column,
  item,
  workspacePreference,
}: BarcodeCellProps) {
  // Column ids are `barcode_<BarcodeType>`; the suffix IS the enum value.
  const barcodeType = column.split("_")[1];

  const barcodes =
    item.barcodes?.filter((barcode) => barcode.type === barcodeType) ?? [];

  if (barcodes.length === 0) {
    return (
      <Td>
        <EmptyTableValue />
      </Td>
    );
  }

  const visibleBarcodes = barcodes.slice(0, MAX_VISIBLE_BARCODES);
  const hiddenBarcodes = barcodes.slice(MAX_VISIBLE_BARCODES);

  return (
    // `whitespace-nowrap` on the cell plus a non-wrapping flex row keeps this
    // cell exactly one line tall no matter how many barcodes the asset has.
    // Do not reintroduce `flex-wrap` here — it grows the entire table row.
    <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
      <div className="flex items-center gap-1.5">
        {visibleBarcodes.map((barcode) => (
          <BarcodeChip
            key={barcode.id}
            barcode={barcode}
            item={item}
            workspacePreference={workspacePreference}
          />
        ))}

        {hiddenBarcodes.length > 0 ? (
          <OverflowBadge hiddenBarcodes={hiddenBarcodes} item={item} />
        ) : null}
      </div>
    </Td>
  );
}

/**
 * A single clickable barcode chip. Opens the code preview dialog focused on
 * this barcode.
 */
function BarcodeChip({
  barcode,
  item,
  workspacePreference,
}: {
  barcode: ItemBarcode;
  item: AdvancedIndexAsset;
  workspacePreference: QrIdDisplayPreference;
}) {
  return (
    <CodePreviewDialog
      item={{
        id: item.id,
        title: item.title,
        qrId: item.qrId,
        type: "asset",
        sequentialId: item.sequentialId,
      }}
      selectedBarcodeId={barcode.id}
      trigger={
        <button
          type="button"
          aria-label={`Show code preview for ${item.title} (${barcode.value})`}
          className={TRIGGER_CLASSES}
        >
          <AssetCodeBadge
            value={barcode.value}
            type={barcode.type}
            isFallback={false}
            workspacePreference={workspacePreference}
            interactive
            // Explicit column: the barcode column shows literal barcode
            // values, not the workspace-preferred one. Tooltip simplifies to
            // "<Type>: <value>".
            explicit
            className="cursor-pointer transition-colors hover:bg-gray-200"
          />
        </button>
      }
    />
  );
}

/**
 * `+N` overflow control. Hover or keyboard focus lists the hidden barcode
 * values; activating it opens the code preview dialog on the first hidden
 * barcode, from where the dialog's own code selector reaches the rest.
 */
function OverflowBadge({
  hiddenBarcodes,
  item,
}: {
  hiddenBarcodes: ItemBarcode[];
  item: AdvancedIndexAsset;
}) {
  return (
    <CodePreviewDialog
      item={{
        id: item.id,
        title: item.title,
        qrId: item.qrId,
        type: "asset",
        sequentialId: item.sequentialId,
      }}
      selectedBarcodeId={hiddenBarcodes[0].id}
      trigger={
        <OverflowTrigger
          hiddenBarcodes={hiddenBarcodes}
          itemTitle={item.title}
        />
      }
    />
  );
}

/**
 * The `+N` button itself, split out so it can be BOTH the tooltip trigger and
 * the dialog trigger.
 *
 * `CodePreviewDialog` clones the element it is handed to attach `onClick`, so
 * whatever it receives must be the outermost node — which means the tooltip
 * cannot wrap it from outside. Taking `onClick` as a prop and forwarding it
 * lets the `<button>` carry the Radix trigger props directly, so the tooltip
 * opens on keyboard focus and not only on hover.
 *
 * @param hiddenBarcodes - The barcodes past the visible cap
 * @param itemTitle - Asset title, used in the button's accessible name
 * @param onClick - Injected by `CodePreviewDialog`; opens the preview dialog
 */
function OverflowTrigger({
  hiddenBarcodes,
  itemTitle,
  onClick,
}: {
  hiddenBarcodes: ItemBarcode[];
  itemTitle: string;
  onClick?: () => void;
}) {
  const plural = hiddenBarcodes.length === 1 ? "" : "s";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          aria-label={`+${hiddenBarcodes.length} more code${plural} for ${itemTitle}`}
          className={TRIGGER_CLASSES}
        >
          <GrayBadge className="cursor-pointer transition-colors hover:bg-gray-200">
            {`+${hiddenBarcodes.length}`}
          </GrayBadge>
        </button>
      </TooltipTrigger>

      <TooltipContent side="top" className="max-w-72">
        <div className="text-left">
          <div className="mb-1 font-semibold text-gray-700">
            {hiddenBarcodes.length} more code{plural}
          </div>
          <div className="flex flex-col gap-0.5 font-normal text-gray-500">
            {hiddenBarcodes.map((barcode) => (
              <span key={barcode.id}>{barcode.value}</span>
            ))}
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
