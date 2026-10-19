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
import { Button } from "~/components/shared/button";
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

/** What the muted second line of a row says about the audit's timing. */
function RowWhen({
  item,
  section,
}: {
  item: AuditHistoryListItem;
  section: "recent" | "upcoming";
}) {
  if (section === "recent") {
    return item.completedAt ? (
      <>
        Completed <DateS date={item.completedAt} />
      </>
    ) : null;
  }
  if (item.status === "ACTIVE") return <>In progress</>;
  return item.dueDate ? (
    <>
      Due <DateS date={item.dueDate} />
    </>
  ) : (
    <>Scheduled</>
  );
}

/**
 * One audit row: the audit name as a link with its timing underneath, and the
 * asset's result in that audit on the right. A scheduled audit has no result
 * yet, so its row carries the audit status instead.
 */
function AuditRow({
  item,
  section,
}: {
  item: AuditHistoryListItem;
  section: "recent" | "upcoming";
}) {
  const isScheduled = section === "upcoming" && item.status === "PENDING";
  return (
    <li className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Link
          to={`/audits/${item.id}`}
          className="block truncate text-sm font-medium text-gray-900 hover:underline"
        >
          {item.name}
        </Link>
        <p className="text-xs tabular-nums text-gray-500">
          <RowWhen item={item} section={section} />
        </p>
      </div>
      <div className="shrink-0">
        {isScheduled ? (
          <AuditStatusBadge status={item.status} />
        ) : (
          <AuditAssetStatusBadge
            status={auditAssetStatusLabel(
              item.assetStatus,
              section === "recent"
            )}
          />
        )}
      </div>
    </li>
  );
}

/** A labelled list of audit rows. */
function Section({
  title,
  items,
  section,
}: {
  title: string;
  items: AuditHistoryListItem[];
  section: "recent" | "upcoming";
}) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {title}
      </h4>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <AuditRow key={item.id} item={item} section={section} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The recent and upcoming sections, each shown only when it has audits and
 * divided by a rule, then the "View all audits" button. Renders nothing when
 * both lists are empty: with no audits there is nothing to list or to view.
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
        <Section title="Recent" items={recent} section="recent" />
      ) : null}
      {recent.length > 0 && upcoming.length > 0 ? (
        <hr className="border-gray-200" />
      ) : null}
      {upcoming.length > 0 ? (
        <Section title="Upcoming" items={upcoming} section="upcoming" />
      ) : null}
      <div>
        <Button to={`/audits?assetId=${assetId}`} variant="secondary" size="xs">
          View all audits
        </Button>
      </div>
    </div>
  );
}
