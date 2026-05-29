/**
 * SamIdCell
 *
 * Renders the "SAM ID" cell in the advanced asset table. SAM has no preview
 * dialog (only QR has one), so the chip is static. Extracted from
 * `advanced-asset-columns.tsx` for the same react-doctor reason as `QrIdCell`.
 */

import type { QrIdDisplayPreference } from "@prisma/client";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import type { AdvancedIndexAsset } from "~/modules/asset/types";
import { Td } from "./td";

type SamIdCellProps = {
  item: AdvancedIndexAsset;
  workspacePreference: QrIdDisplayPreference;
};

/**
 * Renders the SAM ID column cell. Falls back to `<EmptyTableValue>` when
 * `sequentialId` is null (asset created before SAM was enabled, or under a
 * pricing tier that doesn't include SAM).
 */
export function SamIdCell({ item, workspacePreference }: SamIdCellProps) {
  return (
    <Td className="w-full max-w-none !overflow-visible whitespace-nowrap">
      {item.sequentialId ? (
        <AssetCodeBadge
          value={item.sequentialId}
          type="SAM_ID"
          isFallback={false}
          workspacePreference={workspacePreference}
          // Explicit column: this chip is *the SAM ID column*, not the
          // workspace's chosen representative. Tooltip simplifies to
          // "SAM ID: <value>" so we don't misleadingly claim "matches
          // workspace pref" / "per-asset override" against an org that
          // prefers something else.
          explicit
        />
      ) : (
        <EmptyTableValue />
      )}
    </Td>
  );
}
