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

  const hasAudits = history.recent.length > 0 || history.upcoming.length > 0;

  return (
    <Card className="my-3">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[14px] font-medium text-gray-700">Last audit</p>
          <p className="text-[12px] text-gray-600">
            {lastAuditedAt ? (
              <DateS date={lastAuditedAt} />
            ) : (
              "This asset has never been audited"
            )}
          </p>
        </div>
        {hasAudits ? (
          <>
            <hr className="border-gray-200" />
            <AssetAuditHistoryList
              assetId={assetId}
              recent={history.recent}
              upcoming={history.upcoming}
            />
          </>
        ) : null}
      </div>
    </Card>
  );
}
