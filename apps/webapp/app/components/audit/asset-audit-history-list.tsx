/**
 * Asset audit history list
 *
 * The "Recent" and "Upcoming" audit sections for one asset, plus the link to
 * its full audit list. Shared by the hover card on the "Last audit date"
 * column and the "Last audit" card on the asset page, so both surfaces show
 * an asset's audits the same way.
 *
 * @see {@link file://./../assets/assets-index/last-audit-date-cell.tsx}
 * @see {@link file://./../assets/asset-last-audit-card.tsx}
 * @see {@link file://./../../modules/audit/asset-audit-history.server.ts}
 */
import { auditAssetStatusLabel } from "@shelf/labels";
import { Link } from "react-router";
import { AuditAssetStatusBadge } from "~/components/audit/audit-asset-status-badge";
import { AuditStatusBadge } from "~/components/audit/audit-status-badge";
import { DateS } from "~/components/shared/date";
import type { AssetAuditHistoryItem } from "~/modules/audit/asset-audit-history.server";

/**
 * One audit in an asset's history. Dates arrive as `Date` from a loader and
 * as ISO strings from a JSON endpoint; `DateS` renders either.
 */
export type AuditHistoryListItem = Omit<
  AssetAuditHistoryItem,
  "completedAt" | "dueDate"
> & {
  completedAt: string | Date | null;
  dueDate: string | Date | null;
};

/** One audit row, linking to the audit. */
function AuditRow({
  item,
  section,
}: {
  item: AuditHistoryListItem;
  section: "recent" | "upcoming";
}) {
  const isActive = item.status === "ACTIVE";
  return (
    <li>
      <Link
        to={`/audits/${item.id}`}
        className="flex flex-col gap-1 rounded p-1 hover:bg-gray-50"
      >
        <span className="truncate text-sm font-medium text-gray-900">
          {item.name}
        </span>
        <span className="flex flex-wrap items-center gap-1 text-xs text-gray-600">
          {section === "recent" ? (
            <>
              {item.completedAt ? <DateS date={item.completedAt} /> : null}
              <AuditAssetStatusBadge
                status={auditAssetStatusLabel(item.assetStatus, true)}
              />
            </>
          ) : isActive ? (
            <>
              <span>In progress</span>
              <AuditStatusBadge status={item.status} />
              <AuditAssetStatusBadge
                status={auditAssetStatusLabel(item.assetStatus, false)}
              />
            </>
          ) : item.dueDate ? (
            <span>
              Due <DateS date={item.dueDate} />
            </span>
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/**
 * The recent and upcoming sections, each shown only when it has audits, and
 * the "View all audits" link. Renders nothing when both lists are empty: with
 * no audits there is nothing to list or to view.
 *
 * @param props.assetId - The asset; scopes the "View all audits" link
 * @param props.recent - Counted audits, newest first
 * @param props.upcoming - Pending or active audits, soonest due first
 */
export function AssetAuditHistoryList({
  assetId,
  recent,
  upcoming,
}: {
  assetId: string;
  recent: AuditHistoryListItem[];
  upcoming: AuditHistoryListItem[];
}) {
  if (recent.length === 0 && upcoming.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {recent.length > 0 ? (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
            Recent
          </h4>
          <ul>
            {recent.map((item) => (
              <AuditRow key={item.id} item={item} section="recent" />
            ))}
          </ul>
        </section>
      ) : null}
      {upcoming.length > 0 ? (
        <section>
          <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
            Upcoming
          </h4>
          <ul>
            {upcoming.map((item) => (
              <AuditRow key={item.id} item={item} section="upcoming" />
            ))}
          </ul>
        </section>
      ) : null}
      <Link
        to={`/audits?assetId=${assetId}`}
        className="text-sm font-medium text-primary-700 hover:underline"
      >
        View all audits
      </Link>
    </div>
  );
}
