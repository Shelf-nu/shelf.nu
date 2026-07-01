/**
 * QrIdCell
 *
 * Renders the "QR ID" cell in the advanced asset table. The chip is wrapped
 * in a native button so clicking opens the `CodePreviewDialog` (label
 * preview / print). Visually identical to the simple-mode chip; the
 * `explicit` prop simplifies the tooltip because the column itself selects
 * the value (not the workspace preference).
 *
 * Extracted from `advanced-asset-columns.tsx` to keep that file under the
 * react-doctor giant-component threshold.
 */

import type { QrIdDisplayPreference } from "@prisma/client";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { CodePreviewDialog } from "~/components/code-preview/code-preview-dialog";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import { Td } from "./td";

type QrIdCellProps = {
  item: AdvancedIndexAsset;
  workspacePreference: QrIdDisplayPreference;
};

/** Renders the QR ID column cell with the shared chip + preview dialog. */
export function QrIdCell({ item, workspacePreference }: QrIdCellProps) {
  return (
    <CodePreviewDialog
      item={{
        id: item.id,
        title: item.title,
        qrId: item.qrId,
        type: "asset",
        sequentialId: item.sequentialId,
      }}
      trigger={
        <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
          {/*
            Visual parity with the simple-mode AssetCodeBadge: chip styling
            via the shared component, wrapped in a native button so the
            CodePreviewDialog still opens on click. Hover state lifts the
            background; keyboard focus gets a visible ring. Click target
            stays generous because the chip has padding.
          */}
          <button
            type="button"
            aria-label={`Show code preview for ${item.title}`}
            className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1"
          >
            <AssetCodeBadge
              value={item.qrId}
              type="QR_ID"
              isFallback={false}
              workspacePreference={workspacePreference}
              interactive
              // Explicit column: this chip is *the QR ID column*, not the
              // workspace's chosen representative. Tooltip simplifies to
              // "QR ID: <value>" so we don't misleadingly claim "matches
              // workspace pref" / "per-asset override" against an org that
              // prefers something else.
              explicit
              className="cursor-pointer transition-colors hover:bg-gray-200"
            />
          </button>
        </Td>
      }
    />
  );
}
