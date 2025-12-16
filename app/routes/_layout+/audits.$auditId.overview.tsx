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
import { AuditAssetStatusBadge } from "~/components/audit/audit-asset-status-badge";
import { AuditStatusBadge } from "~/components/audit/audit-status-badge";
import { AuditStatusFilter } from "~/components/audit/audit-status-filter";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { Td, Th } from "~/components/table";
import { useSearchParams } from "~/hooks/search-params";
import {
  getAuditFilterMetadata,
  getAuditStatusLabel,
} from "~/modules/audit/audit-filter-utils";
import type { AuditFilterType } from "~/modules/audit/audit-filter-utils";
import { completeAuditWithImages } from "~/modules/audit/complete-audit-with-images.server";
import { getAuditImages } from "~/modules/audit/image.service.server";
import {
  getAuditSessionDetails,
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
import { tw } from "~/utils/tw";

const label = "Audit";

const AUDIT_STATUS_ITEMS = {
  EXPECTED: "EXPECTED",
  FOUND: "FOUND",
  MISSING: "MISSING",
  UNEXPECTED: "UNEXPECTED",
};

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

    const [{ session }, assetsData, auditImages] = await Promise.all([
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
      getAuditImages({
        auditSessionId: auditId,
        organizationId,
        auditAssetId: undefined, // Get general audit images only
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
        auditImages,
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

    const formData = await request.clone().formData();
    const intent = formData.get("intent");

    if (intent === "complete-audit") {
      await completeAuditWithImages({
        request,
        auditSessionId: auditId,
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
  const { session, totalItems, auditImages } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentFilter = searchParams.get(
    "auditStatus"
  ) as AuditFilterType | null;
  const showAuditStatusColumn = currentFilter === "ALL";

  const expectedCount = session.expectedAssetCount || 0;
  const foundCount = session.foundAssetCount || 0;
  const missingCount = session.missingAssetCount || 0;
  const unexpectedCount = session.unexpectedAssetCount || 0;

  const filterMetadata = getAuditFilterMetadata(currentFilter);

  return (
    <div className="mt-8 flex flex-col gap-6">
      {/* Three Column Layout with Flex: Stats, Audit Info, Images */}
      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left Column: Stats Cards */}
        <div className="flex-1">
          <h2 className="mb-4 text-lg font-semibold">Statistics</h2>
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Expected"
              value={expectedCount}
              filterType="EXPECTED"
              isActive={currentFilter === "EXPECTED" || !currentFilter}
            />
            <StatCard
              label="Found"
              value={foundCount}
              filterType="FOUND"
              isActive={currentFilter === "FOUND"}
            />
            <StatCard
              label="Missing"
              value={missingCount}
              filterType="MISSING"
              isActive={currentFilter === "MISSING"}
            />
            <StatCard
              label="Unexpected"
              value={unexpectedCount}
              filterType="UNEXPECTED"
              isActive={currentFilter === "UNEXPECTED"}
            />
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

        {/* Right Column: Audit Images */}
        <div className="flex-1">
          <h2 className="mb-4 text-lg font-semibold">Images</h2>
          <Card className="mt-0 md:border">
            {auditImages.length > 0 ? (
              <div className="flex flex-wrap gap-3">
                {auditImages.map((image) => (
                  <ImageWithPreview
                    key={image.id}
                    imageUrl={image.imageUrl}
                    thumbnailUrl={image.thumbnailUrl}
                    alt={image.description || "Audit image"}
                    withPreview
                    className="size-24 rounded border"
                    images={auditImages.map((img) => ({
                      id: img.id,
                      imageUrl: img.imageUrl,
                      thumbnailUrl: img.thumbnailUrl,
                      alt: img.description || "Audit image",
                    }))}
                    currentImageId={image.id}
                  />
                ))}
              </div>
            ) : (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                No images uploaded
              </div>
            )}
          </Card>
        </div>
      </div>

      {/* Assets List */}
      <div>
        <h2 className="mb-4 text-lg font-semibold">
          {filterMetadata.label} ({totalItems})
        </h2>
        <Filters
          className="responsive-filters mb-2"
          slots={{
            "right-of-search": (
              <AuditStatusFilter statusItems={AUDIT_STATUS_ITEMS} />
            ),
          }}
        />
        <List
          ItemComponent={AssetListItem}
          customEmptyStateContent={filterMetadata.emptyState}
          headerChildren={
            <>
              {showAuditStatusColumn && (
                <Th className="whitespace-nowrap">Audit Status</Th>
              )}
              <Th>Category</Th>
              <Th>Location</Th>
            </>
          }
          className="overflow-x-visible md:overflow-x-auto"
        />
      </div>
    </div>
  );
}

type LoaderData = Awaited<ReturnType<typeof loader>>;
type AuditAssetItem = LoaderData["data"]["items"][number];

function AssetListItem({ item }: { item: AuditAssetItem }) {
  const { category, location } = item;
  const [searchParams] = useSearchParams();
  const currentFilter = searchParams.get("auditStatus");

  // Show audit status column when "ALL" filter is active
  const showAuditStatus = currentFilter === "ALL";
  const auditStatusLabel = item.auditData
    ? getAuditStatusLabel(item.auditData)
    : null;

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
      {showAuditStatus && (
        <Td>
          {auditStatusLabel ? (
            <AuditAssetStatusBadge status={auditStatusLabel} />
          ) : (
            <EmptyTableValue />
          )}
        </Td>
      )}
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
  filterType,
  isActive,
}: {
  label: string;
  value: number;
  filterType: AuditFilterType;
  isActive: boolean;
}) {
  const [, setSearchParams] = useSearchParams();

  const handleClick = () => {
    setSearchParams((prev) => {
      prev.set("auditStatus", filterType);
      return prev;
    });
  };

  return (
    <button
      onClick={handleClick}
      className={tw(
        "rounded-lg border p-4 text-left transition-all hover:shadow-md",
        isActive
          ? "border-gray-900 bg-gray-900 text-white"
          : "border-gray-200 bg-white text-gray-900 hover:border-gray-300"
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
    </button>
  );
}
