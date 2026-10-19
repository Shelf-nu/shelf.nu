/**
 * Last audit date cell
 *
 * Renders the "Last audit date" column of the advanced assets index. When the
 * column is available, the date is a hover card trigger that lazily loads the
 * asset's recent and upcoming audits. When audits are locked for the workspace
 * the cell is a call to action instead.
 *
 * @see {@link file://./advanced-asset-columns.tsx}
 * @see {@link file://./../../../routes/api+/assets.$assetId.audit-history.ts}
 */
import { useState } from "react";
import { auditAssetStatusLabel } from "@shelf/labels";
import { Link } from "react-router";
import { AuditAssetStatusBadge } from "~/components/audit/audit-asset-status-badge";
import { AuditStatusBadge } from "~/components/audit/audit-status-badge";
import { DateS } from "~/components/shared/date";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "~/components/shared/hover-card";
import useApiQuery from "~/hooks/use-api-query";
import type { LastAuditDateAccess } from "~/modules/asset/last-audit-date-access";
import type { AssetAuditHistoryItem } from "~/modules/audit/asset-audit-history.server";
import { Td } from "./advanced-columns/td";

/** An audit history item as it arrives over JSON (dates are ISO strings). */
type SerializedAuditHistoryItem = Omit<
  AssetAuditHistoryItem,
  "completedAt" | "dueDate"
> & {
  completedAt: string | null;
  dueDate: string | null;
};

/**
 * Response body of the audit-history endpoint. A failed request answers with
 * an `error` object and no lists; a successful one stamps `error: null`.
 */
type AuditHistoryData = {
  recent?: SerializedAuditHistoryItem[];
  upcoming?: SerializedAuditHistoryItem[];
  error?: unknown;
};
/** One audit row inside the hover card. */
function AuditRow({
  item,
  section,
}: {
  item: SerializedAuditHistoryItem;
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

/** Body of the hover card: loading, empty and populated states. */
function HistoryBody({
  assetId,
  data,
  failed,
}: {
  assetId: string;
  data: AuditHistoryData | undefined;
  failed: boolean;
}) {
  if (failed || (data && (data.error || !data.recent || !data.upcoming))) {
    return <p className="text-sm text-gray-600">Could not load audits.</p>;
  }

  if (!data || !data.recent || !data.upcoming) {
    return (
      <p className="text-sm text-gray-600" role="status">
        Loading audits...
      </p>
    );
  }

  const { recent, upcoming } = data;
  if (recent.length === 0 && upcoming.length === 0) {
    return <p className="text-sm text-gray-600">No audits for this asset.</p>;
  }

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

/**
 * Table cell for the last audit date column.
 *
 * @param props.assetId - The asset the row belongs to
 * @param props.lastAuditDate - ISO date of the latest counted audit, if any
 * @param props.access - `available` shows the date, `locked` a CTA, `hidden` nothing
 */
export function LastAuditDateCell({
  assetId,
  lastAuditDate,
  access,
}: {
  assetId: string;
  lastAuditDate: string | null | undefined;
  access: LastAuditDateAccess;
}) {
  /** Load once per mount: set when the card first opens, never reset. */
  const [requested, setRequested] = useState(false);
  const { data, error } = useApiQuery<AuditHistoryData>({
    api: `/api/assets/${assetId}/audit-history`,
    enabled: access === "available" && requested,
  });

  if (access === "hidden") return null;

  if (access === "locked") {
    return (
      <Td>
        <Link
          to="/audits"
          className="text-sm font-medium text-primary-700 hover:underline"
        >
          Unlock audits
        </Link>
      </Td>
    );
  }

  function handleOpenChange(open: boolean) {
    if (open) setRequested(true);
  }

  return (
    <Td>
      <HoverCard openDelay={200} onOpenChange={handleOpenChange}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            className="rounded px-1 text-left text-sm hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary-600"
          >
            {lastAuditDate ? <DateS date={lastAuditDate} /> : "Never audited"}
          </button>
        </HoverCardTrigger>
        <HoverCardContent className="w-72" align="start">
          <HistoryBody assetId={assetId} data={data} failed={Boolean(error)} />
        </HoverCardContent>
      </HoverCard>
    </Td>
  );
}
