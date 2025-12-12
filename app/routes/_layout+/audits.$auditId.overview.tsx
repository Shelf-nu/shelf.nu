import { OrganizationRoles } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";

import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { CategoryBadge } from "~/components/assets/category-badge";
import { AuditStatusBadge } from "~/components/audit/audit-status-badge";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { Td, Th } from "~/components/table";
import {
  getAuditSessionDetails,
  completeAuditSession,
  getAssetsForAuditSession,
} from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

const label = "Audit";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "Audit Overview" },
];

export const handle = {
  breadcrumb: () => "Overview",
};

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const permissionResult = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.read,
    });

    const { organizationId, userOrganizations } = permissionResult;

    const [{ session }, assetsData] = await Promise.all([
      getAuditSessionDetails({
        id: auditId,
        organizationId,
        userOrganizations,
        request,
      }),
      getAssetsForAuditSession({
        request,
        organizationId,
        auditSessionId: auditId,
      }),
    ]);

    const header = { title: `${session.name} · Overview` };

    const rolesForOrg = userOrganizations.find(
      (org) => org.organization.id === organizationId
    )?.roles;

    const isAdminOrOwner = rolesForOrg
      ? rolesForOrg.includes(OrganizationRoles.ADMIN) ||
        rolesForOrg.includes(OrganizationRoles.OWNER)
      : false;

    if (!isAdminOrOwner) {
      const isAssignee = session.assignments.some(
        (assignment) => assignment.userId === userId
      );

      if (!isAssignee) {
        throw new ShelfError({
          cause: null,
          message: "You are not assigned to this audit.",
          additionalData: { auditId, userId },
          status: 403,
          label,
        });
      }
    }

    return data(
      payload({
        session,
        isAdminOrOwner,
        header,
        ...assetsData,
        modelName: {
          singular: "asset",
          plural: "assets",
        },
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { auditId } = getParams(params, z.object({ auditId: z.string() }), {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const formData = await request.formData();
    const intent = formData.get("intent");

    if (intent === "complete-audit") {
      await completeAuditSession({
        sessionId: auditId,
        organizationId,
        userId,
      });

      return redirect(`/audits/${auditId}/overview`);
    }

    throw new ShelfError({
      cause: null,
      message: "Invalid action intent",
      additionalData: { intent },
      label,
      status: 400,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, auditId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AuditOverview() {
  const { session, totalItems } = useLoaderData<typeof loader>();

  const totalExpected = totalItems;
  const foundCount = session.foundAssetCount || 0;
  const missingCount = session.missingAssetCount || 0;
  const unexpectedCount = session.unexpectedAssetCount || 0;

  return (
    <div className="mt-8 flex flex-col gap-6">
      {/* Two Column Layout with Flex: Stats & Audit Info */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left Column: Stats Cards */}
        <div className="flex-1">
          <h2 className="mb-4 text-lg font-semibold">Statistics</h2>
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Expected" value={totalExpected} color="blue" />
            <StatCard label="Found" value={foundCount} color="green" />
            <StatCard label="Missing" value={missingCount} color="yellow" />
            <StatCard label="Unexpected" value={unexpectedCount} color="red" />
          </div>
        </div>

        {/* Right Column: Audit Information */}
        <div className="flex-1">
          <h2 className="mb-4 text-lg font-semibold">Audit Information</h2>
          <Card className="mt-0 px-[-4] py-[-5] md:border">
            <ul className="item-information">
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-gray-900">
                  Status
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                  <AuditStatusBadge status={session.status} />
                </div>
              </li>
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-gray-900">
                  Created
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                  <DateS
                    date={session.createdAt}
                    options={{ dateStyle: "short", timeStyle: "short" }}
                  />
                </div>
              </li>
              {session.startedAt && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-gray-900">
                    Started
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                    <DateS
                      date={session.startedAt}
                      options={{ dateStyle: "short", timeStyle: "short" }}
                    />
                  </div>
                </li>
              )}
              {session.completedAt && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-gray-900">
                    Completed
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                    <DateS
                      date={session.completedAt}
                      options={{ dateStyle: "short", timeStyle: "short" }}
                    />
                  </div>
                </li>
              )}
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-gray-900">
                  Created by
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                  {session.createdBy.firstName} {session.createdBy.lastName}
                </div>
              </li>
            </ul>
          </Card>
        </div>
      </div>

      {/* Expected Assets List */}
      {totalExpected > 0 && (
        <div>
          <h2 className="mb-4 text-lg font-semibold">
            Expected Assets ({totalExpected})
          </h2>
          <Filters className="responsive-filters mb-2" />
          <List
            ItemComponent={AssetListItem}
            customEmptyStateContent={{
              title: "No expected assets",
              text: "This audit has no assets assigned to it.",
            }}
            headerChildren={
              <>
                <Th>Category</Th>
                <Th>Location</Th>
              </>
            }
            className="overflow-x-visible md:overflow-x-auto"
          />
        </div>
      )}
    </div>
  );
}

type LoaderData = Awaited<ReturnType<typeof loader>>;
type AuditAssetItem = LoaderData["data"]["items"][number];

function AssetListItem({ item }: { item: AuditAssetItem }) {
  const { category, location } = item;

  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={`Image of ${item.title}`}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                  target="_blank"
                  onlyNewTabIconOnHover
                >
                  {item.title}
                </Button>
              </span>
              <AssetStatusBadge
                id={item.id}
                status={item.status}
                availableToBook={item.availableToBook}
              />
            </div>
          </div>
        </div>
      </Td>

      <Td>
        {category ? <CategoryBadge category={category} /> : <EmptyTableValue />}
      </Td>

      <Td>
        {location ? (
          <LocationBadge
            location={{
              id: location.id,
              name: location.name,
              parentId: location.parentId ?? undefined,
              childCount: location._count.children,
            }}
          />
        ) : (
          <EmptyTableValue />
        )}
      </Td>
    </>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "blue" | "green" | "yellow" | "red";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-700",
    green: "bg-green-50 text-green-700",
    yellow: "bg-yellow-50 text-yellow-700",
    red: "bg-red-50 text-red-700",
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
    </div>
  );
}
