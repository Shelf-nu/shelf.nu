/**
 * Asset last audit card
 *
 * Sidebar card on the asset page: when the asset was last audited, plus its
 * recent and upcoming audits. The date follows the "Last audit date" column's
 * rule (the newest completed or archived audit), so the page and the index
 * agree. The overview loader only sends the history to callers who may see
 * the column, so a missing history means no card.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://./../audit/asset-audit-history-list.tsx}
 */
import type { AuditHistoryListItem } from "~/components/audit/asset-audit-history-list";
import { AssetAuditHistoryList } from "~/components/audit/asset-audit-history-list";
import Icon from "~/components/icons/icon";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";

/**
 * Renders the last audit card, or nothing when there is no history to show.
 *
 * @param props.assetId - The asset the card belongs to
 * @param props.history - The asset's recent and upcoming audits, or null when
 *   the caller may not see audit dates
 */
export function AssetLastAuditCard({
  assetId,
  history,
}: {
  assetId: string;
  history: {
    recent: AuditHistoryListItem[];
    upcoming: AuditHistoryListItem[];
  } | null;
}) {
  if (!history) return null;

  const lastAuditedAt = history.recent[0]?.completedAt ?? null;

  return (
    <Card className="my-3 py-3 md:border">
      <div className="flex items-start gap-3">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gray-100/50">
          <div className="flex size-7 items-center justify-center rounded-full bg-gray-200">
            <Icon icon="start-audit" />
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div>
            <h3 className="mb-1 text-sm font-semibold">Last audit</h3>
            <p className="text-sm text-gray-700">
              {lastAuditedAt ? <DateS date={lastAuditedAt} /> : "Never audited"}
            </p>
          </div>
          <AssetAuditHistoryList
            assetId={assetId}
            recent={history.recent}
            upcoming={history.upcoming}
          />
        </div>
      </div>
    </Card>
  );
}
