import type { AuditStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { data } from "react-router";
import { DescriptionColumn } from "~/components/assets/assets-index/advanced-asset-columns";
import { AuditStatusBadge } from "~/components/audit/audit-status-badge";
import { StatusFilter } from "~/components/booking/status-filter";
import Header from "~/components/layout/header";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { Filters } from "~/components/list/filters";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
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

export async function loader({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const { organizationId } = await requirePermission({
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

    const { audits, totalAudits } = await getAuditsForOrganization({
      organizationId,
      page,
      perPage,
      search,
      status,
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

export default function AuditsIndexPage() {
  return (
    <>
      <Header>
        <Button to="new" role="link" aria-label="new audit">
          New audit
        </Button>
      </Header>
      <ListContentWrapper>
        <Filters
          slots={{
            "left-of-search": (
              <StatusFilter
                statusItems={{
                  PENDING: "PENDING",
                  ACTIVE: "ACTIVE",
                  COMPLETED: "COMPLETED",
                  CANCELLED: "CANCELLED",
                }}
              />
            ),
          }}
        />
        <List
          ItemComponent={ListItemContent}
          headerChildren={
            <>
              <Th>Status</Th>
              <Th>Description</Th>
              <Th>Created by</Th>
              <Th>Created</Th>
              <Th>Started</Th>
              <Th>Completed</Th>
              <Th className="text-right">Expected</Th>
              <Th className="text-right">Found</Th>
              <Th className="text-right">Missing</Th>
              <Th className="text-right">Unexpected</Th>
            </>
          }
        />
      </ListContentWrapper>
    </>
  );
}

type AuditListItem = Prisma.AuditSessionGetPayload<{
  include: typeof AUDIT_LIST_INCLUDE;
}>;

const ListItemContent = ({ item }: { item: AuditListItem }) => {
  const { createdBy } = item;
  const creatorName =
    createdBy?.firstName && createdBy?.lastName
      ? `${createdBy.firstName} ${createdBy.lastName}`
      : createdBy?.email || "Unknown";
  const creatorImg =
    createdBy?.profilePicture || "/static/images/default_pfp.jpg";

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
        <AuditStatusBadge status={item.status} />
      </Td>

      <DescriptionColumn value={item.description || ""} />

      <Td>
        <UserBadge name={creatorName} img={creatorImg} />
      </Td>

      <Td>
        <DateS
          date={item.createdAt}
          options={{ dateStyle: "short", timeStyle: "short" }}
        />
      </Td>

      <Td>
        {item.startedAt ? (
          <DateS
            date={item.startedAt}
            options={{ dateStyle: "short", timeStyle: "short" }}
          />
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      <Td>
        {item.completedAt ? (
          <DateS
            date={item.completedAt}
            options={{ dateStyle: "short", timeStyle: "short" }}
          />
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      <Td className="text-right">{item.expectedAssetCount}</Td>

      <Td className="text-right">
        {item.foundAssetCount ?? <EmptyTableValue />}
      </Td>

      <Td className="text-right">
        {item.missingAssetCount ?? <EmptyTableValue />}
      </Td>

      <Td className="text-right">
        {item.unexpectedAssetCount ?? <EmptyTableValue />}
      </Td>
    </>
  );
};
