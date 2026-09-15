import type { AuditStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  AUDIT_ASSET_STATUS_LABELS,
  AUDIT_STATUS_LABELS,
  auditAssetStatusLabel,
  isAuditCompleted,
} from "@shelf/labels";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data, useLoaderData } from "react-router";
import { DescriptionColumn } from "~/components/assets/assets-index/advanced-asset-columns";
import AuditIndexBulkActionsDropdown from "~/components/audit/audit-index-bulk-actions-dropdown";
import { AuditStatusBadgeWithOverdue } from "~/components/audit/audit-status-badge-with-overdue";
import { AuditStatusFilter } from "~/components/audit/audit-status-filter";
import { NewAuditInfoDialog } from "~/components/audit/new-audit-info-dialog";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import type { SortingDirection } from "~/components/list/filters/sort-by";
import { SortBy } from "~/components/list/filters/sort-by";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { UserBadge } from "~/components/shared/user-badge";
import { Td, Th } from "~/components/table";
import type { AUDIT_LIST_INCLUDE } from "~/modules/audit/service.server";
import { getAuditsForOrganization } from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import {
  setCookie,
  updateCookieWithPerPage,
  userPrefs,
} from "~/utils/cookies.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { resolveUserDisplayName } from "~/utils/user";

const AUDIT_SORTING_OPTIONS = {
  name: "Name",
  createdAt: "Creation Date",
  dueDate: "Due date",
} as const;

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    // Get status filter from search params
    const statusFilter = searchParams.get("status");
    const status =
      statusFilter && statusFilter !== "ALL"
        ? (statusFilter.toUpperCase() as AuditStatus)
        : null;

    // Get sorting params
    const orderBy = searchParams.get("orderBy") ?? "createdAt";
    const orderDirection = (searchParams.get("orderDirection") ??
      "desc") as SortingDirection;

    const { audits, totalAudits } = await getAuditsForOrganization({
      organizationId,
      userId,
      isSelfServiceOrBase,
      page,
      perPage,
      search,
      status,
      orderBy,
      orderDirection,
    });

    const totalPages = Math.ceil(totalAudits / perPage);

    const header: HeaderData = {
      title: "Audits",
    };

    const modelName = {
      singular: "audit",
      plural: "audits",
    };

    return data(
      payload({
        header,
        items: audits,
        search,
        page,
        totalItems: totalAudits,
        totalPages,
        perPage,
        modelName,
        isSelfServiceOrBase,
        searchFieldTooltip: {
          title: "Search audits",
          text: "Search audits by name or description.",
        },
      }),
      {
        headers: [setCookie(await userPrefs.serialize(cookie))],
      }
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    throw data(error(reason), { status: reason.status });
  }
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

/** Loader data type re-exported for child components (e.g. bulk archive dialog). */
export type AuditsIndexLoaderData = typeof loader;

export default function AuditsIndexPage() {
  const { isSelfServiceOrBase } = useLoaderData<typeof loader>();
  return (
    <>
      <Header>{!isSelfServiceOrBase && <NewAuditInfoDialog />}</Header>
      <ListContentWrapper>
        <Filters
          slots={{
            "left-of-search": (
              // why: AuditStatusFilter, not the booking StatusFilter. Its
              // key->label contract lets the dropdown read the shared
              // AUDIT_STATUS_LABELS while the URL keeps the enum names the
              // loader parses; the booking component renders the raw values,
              // which is why this list used to sentence-case "PENDING" by CSS.
              <AuditStatusFilter
                name="status"
                statusOptions={AUDIT_STATUS_LABELS}
              />
            ),
            "right-of-search": (
              <SortBy
                sortingOptions={AUDIT_SORTING_OPTIONS}
                defaultSortingBy="createdAt"
                defaultSortingDirection="desc"
              />
            ),
          }}
        />
        <List
          bulkActions={
            isSelfServiceOrBase ? undefined : <AuditIndexBulkActionsDropdown />
          }
          ItemComponent={ListItemContent}
          headerChildren={
            <>
              <Th>Status</Th>
              <Th>Description</Th>
              <Th>Created by</Th>
              <Th>Assignees</Th>
              <Th className="whitespace-nowrap">Due date</Th>
              <Th>Created</Th>
              <Th>Started</Th>
              <Th>Completed</Th>
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Found</Th>
              {/* why: one header spans audits in every state, so it uses the
                  word that is true in both — "Not scanned". ("Missing" was
                  not: missingAssetCount is seeded with the full expected count
                  at creation, so it claimed a brand-new audit had already lost
                  its assets.) The tooltip reconciles it with the audit detail
                  page, which calls the same count "Missing" once the audit is
                  completed; each CELL repeats that per-row in its title. */}
              <Th className="text-right">
                <span className="inline-flex items-center gap-1">
                  {AUDIT_ASSET_STATUS_LABELS.PENDING}
                  <InfoTooltip
                    iconClassName="size-3.5"
                    content={
                      <p className="text-sm text-gray-600">
                        Expected assets that have not been scanned. Once an
                        audit is completed these are reported as &ldquo;
                        {AUDIT_ASSET_STATUS_LABELS.MISSING}&rdquo; on its
                        overview page.
                      </p>
                    }
                  />
                </span>
              </Th>
              <Th className="text-right">Unexpected</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

/** Shape of a row in the audits index list (includes relations from AUDIT_LIST_INCLUDE). */
export type AuditListItem = Prisma.AuditSessionGetPayload<{
  include: typeof AUDIT_LIST_INCLUDE;
}>;

const ListItemContent = ({ item }: { item: AuditListItem }) => {
  const { createdBy } = item;
  const creatorName =
    resolveUserDisplayName(createdBy) || createdBy?.email || "Unknown";
  const creatorImg =
    createdBy?.profilePicture || "/static/images/default_pfp.jpg";

  // Get the first assignee to display
  const firstAssignment = item.assignments[0];
  const assigneeName = firstAssignment?.user
    ? resolveUserDisplayName(firstAssignment.user) ||
      firstAssignment.user.email ||
      "Unknown"
    : null;
  const assigneeImg =
    firstAssignment?.user?.profilePicture || "/static/images/default_pfp.jpg";
  const hasMultipleAssignees = item.assignments.length > 1;
  // The rest of the team, for the "+N" badge's tooltip
  const otherAssigneeNames = item.assignments
    .slice(1)
    .map(
      (assignment) =>
        resolveUserDisplayName(assignment.user) ||
        assignment.user?.email ||
        "Unknown"
    )
    .join(", ");

  return (
    <>
      <Td className="w-full p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div>
            <Button
              to={`${item.id}/overview`}
              variant="link"
              className="text-left font-medium text-gray-900 hover:text-gray-700"
            >
              {item.name}
            </Button>
          </div>
        </div>
      </Td>

      <Td>
        <AuditStatusBadgeWithOverdue
          status={item.status}
          dueDate={item.dueDate}
        />
      </Td>

      <DescriptionColumn value={item.description || ""} />

      <Td>
        <UserBadge name={creatorName} img={creatorImg} />
      </Td>

      <Td>
        {assigneeName ? (
          <div className="flex items-center gap-1">
            <UserBadge name={assigneeName} img={assigneeImg} />
            {hasMultipleAssignees && (
              <span
                className="text-xs text-gray-500"
                title={otherAssigneeNames}
              >
                +{item.assignments.length - 1}
              </span>
            )}
          </div>
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      <Td>
        {item.dueDate ? (
          <DateS date={item.dueDate} includeTime />
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      <Td>
        <DateS date={item.createdAt} includeTime />
      </Td>

      <Td>
        {item.startedAt ? (
          <DateS date={item.startedAt} includeTime />
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      <Td>
        {item.completedAt ? (
          <DateS date={item.completedAt} includeTime />
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      <Td className="text-right">{item.expectedAssetCount}</Td>

      <Td className="text-right">
        {item.foundAssetCount ?? <EmptyTableValue />}
      </Td>

      {/* why: the header is necessarily state-neutral, but this row is not —
          `item.completedAt` tells us exactly which word the audit's own
          overview page uses for this number. Surfacing it here keeps the list
          and the detail page from naming the same count differently. */}
      <Td
        className="text-right"
        title={`${auditAssetStatusLabel("PENDING", isAuditCompleted(item))}: ${
          item.missingAssetCount ?? 0
        }`}
      >
        {item.missingAssetCount ?? <EmptyTableValue />}
      </Td>

      <Td className="text-right">
        {item.unexpectedAssetCount ?? <EmptyTableValue />}
      </Td>
    </>
  );
};
