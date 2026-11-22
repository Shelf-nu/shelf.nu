/**
 * Asset last audit card
 *
 * Sidebar card on the asset page. The headline is the asset's last audit (its
 * name, completion date and the asset's result in it), followed by up to three
 * earlier audits and up to three upcoming ones. The last audit follows the "Last audit date" column's
 * rule (the newest completed or archived audit), so the page and the index
 * agree. The overview loader only sends the history to callers who may see
 * the column, so a missing history means no card.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.tsx}
 * @see {@link file://./../audit/asset-audit-history-list.tsx}
 */
import type { AuditHistoryListItem } from "~/components/audit/asset-audit-history-list";
import {
  AssetAuditHistoryList,
  AuditRow,
} from "~/components/audit/asset-audit-history-list";
import { Card } from "~/components/shared/card";

/** Audits listed under "Earlier" and under "Upcoming". */
const MAX_PER_SECTION = 3;

/**
 * How many counted audits the overview loader reads: the headline audit plus
 * a full "Earlier" section.
 */
export const LAST_AUDIT_CARD_RECENT_LIMIT = MAX_PER_SECTION + 1;

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

  // The newest counted audit is the headline; the rest are "Earlier".
  const [lastAudit, ...earlier] = history.recent;
  const upcoming = history.upcoming.slice(0, MAX_PER_SECTION);

  return (
    <Card className="my-3">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-[14px] font-medium text-gray-700">Last audit</p>
          {lastAudit ? (
            <ul>
              <AuditRow item={lastAudit} section="recent" />
            </ul>
          ) : (
            <p className="text-[12px] text-gray-600">
              This asset has never been audited
            </p>
          )}
        </div>
        {lastAudit || upcoming.length > 0 ? (
          <>
            {earlier.length > 0 || upcoming.length > 0 ? (
              <hr className="border-gray-200" />
            ) : null}
            <AssetAuditHistoryList
              assetId={assetId}
              recent={earlier.slice(0, MAX_PER_SECTION)}
              upcoming={upcoming}
              recentTitle="Earlier"
              showViewAll
            />
          </>
        ) : null}
      </div>
    </Card>
  );
}
