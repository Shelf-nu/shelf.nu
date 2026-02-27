import { OrganizationRoles } from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";

import { AssetImage } from "~/components/assets/asset-image";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import { AuditAssetRowActionsDropdown } from "~/components/audit/audit-asset-row-actions-dropdown";
import { AuditAssetStatusBadge } from "~/components/audit/audit-asset-status-badge";
import { AuditStatusBadgeWithOverdue } from "~/components/audit/audit-status-badge-with-overdue";
import { AuditStatusFilter } from "~/components/audit/audit-status-filter";
import BulkActionsDropdown from "~/components/audit/bulk-actions-dropdown";
import { BulkRemoveAssetsFromAuditSchema } from "~/components/audit/bulk-remove-assets-from-audit-dialog";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { UserBadge } from "~/components/shared/user-badge";
import { Td, Th } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
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
  cancelAuditSession,
  requireAuditAssignee,
  requireAuditAssigneeForBaseSelfService,
  removeAssetFromAudit,
  removeAssetsFromAudit,
} from "~/modules/audit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { getClientHint } from "~/utils/client-hints";
import { makeShelfError, ShelfError } from "~/utils/error";
import { error, getParams, parseData, payload } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
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
    const isSelfServiceOrBase = permissionResult.isSelfServiceOrBase || false;

    const [{ session }, assetsData, allImages] = await Promise.all([
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
        // undefined = get ALL images
      }),
    ]);

    // Split images into general and asset-specific
    const generalImages = allImages.filter((img) => img.auditAssetId === null);
    const assetImages = allImages.filter((img) => img.auditAssetId !== null);

    const header = { title: `${session.name} · Overview` };

    const rolesForOrg = userOrganizations.find(
      (org) => org.organization.id === organizationId
    )?.roles;

    const isAdminOrOwner = rolesForOrg
      ? rolesForOrg.includes(OrganizationRoles.ADMIN) ||
        rolesForOrg.includes(OrganizationRoles.OWNER)
      : false;

    // Calculate permission to remove assets
    // Only creator or admins/owners can remove assets, and only from PENDING audits
    const isCreator = session.createdById === userId;
    const canRemoveAssets =
      (isCreator || isAdminOrOwner) && session.status === "PENDING";

    requireAuditAssigneeForBaseSelfService({
      audit: session,
      userId,
      isSelfServiceOrBase,
      auditId,
    });

    return data(
      payload({
        session,
        isAdminOrOwner,
        canRemoveAssets,
        userId,
        header,
        generalImages,
        assetImages,
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
    const { organizationId, isSelfServiceOrBase } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.audit,
      action: PermissionAction.update,
    });

    const formData = await request.clone().formData();
    const intent = formData.get("intent");

    if (intent === "complete-audit") {
      // Only assignees can complete the audit
      // Exception: if audit has no assignees, admins/owners can complete
      await requireAuditAssignee({
        auditSessionId: auditId,
        organizationId,
        userId,
        request,
        isSelfServiceOrBase,
      });

      await completeAuditWithImages({
        request,
        auditSessionId: auditId,
        organizationId,
        userId,
      });

      return redirect(`/audits/${auditId}/overview`);
    }

    if (intent === "cancel-audit") {
      const hints = getClientHint(request);
      await cancelAuditSession({
        auditSessionId: auditId,
        organizationId,
        userId,
        hints,
      });

      return redirect(`/audits/${auditId}/overview`);
    }

    if (intent === "remove-asset") {
      const auditAssetId = formData.get("auditAssetId") as string;

      if (!auditAssetId) {
        throw new ShelfError({
          cause: null,
          message: "Audit asset ID is required",
          additionalData: { intent },
          label,
          status: 400,
        });
      }

      await removeAssetFromAudit({
        auditId,
        auditAssetId,
        organizationId,
        userId,
      });

      return redirect(`/audits/${auditId}/overview`);
    }

    if (intent === "bulk-remove-assets") {
      const { assetIds } = parseData(formData, BulkRemoveAssetsFromAuditSchema);

      // Convert assetIds to auditAssetIds
      const auditAssets = await db.auditAsset.findMany({
        where: {
          auditSessionId: auditId,
          assetId: { in: assetIds },
        },
        select: { id: true },
      });

      const auditAssetIds = auditAssets.map((aa) => aa.id);

      if (auditAssetIds.length === 0) {
        throw new ShelfError({
          cause: null,
          message: "No matching assets found in audit",
          additionalData: { intent, assetIds },
          label,
          status: 400,
        });
      }

      await removeAssetsFromAudit({
        auditId,
        auditAssetIds,
        organizationId,
        userId,
      });

      return data(payload({ success: true }));
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
  const { session, totalItems, generalImages, assetImages, canRemoveAssets } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const currentFilter = searchParams.get(
    "auditStatus"
  ) as AuditFilterType | null;
  // Show audit status column when "ALL" or "EXPECTED" filter is selected
  // - ALL: Shows status for all assets (Expected/Found/Missing/Unexpected)
  // - EXPECTED: Shows status for expected assets (Expected/Found or Missing/Found based on audit state)
  const showAuditStatusColumn =
    currentFilter === null ||
    currentFilter === "ALL" ||
    currentFilter === "EXPECTED";
  const assignedUsers = session.assignments;

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
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Statistics</h2>
            {currentFilter && currentFilter !== "ALL" && <ClearFilterButton />}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Expected"
              value={expectedCount}
              filterType="EXPECTED"
              isActive={currentFilter === "EXPECTED"}
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
                <span className="w-2/5 text-[14px] font-medium text-color-900">
                  Status
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-color-600 md:mt-0">
                  <AuditStatusBadgeWithOverdue
                    status={session.status}
                    dueDate={session.dueDate}
                  />
                </div>
              </li>
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-color-900">
                  Created
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-color-600 md:mt-0">
                  <DateS
                    date={session.createdAt}
                    options={{ dateStyle: "short", timeStyle: "short" }}
                  />
                </div>
              </li>
              {session.dueDate && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-color-900">
                    Due date
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-color-600 md:mt-0">
                    <DateS
                      date={session.dueDate}
                      options={{ dateStyle: "short", timeStyle: "short" }}
                    />
                  </div>
                </li>
              )}
              {session.startedAt && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-color-900">
                    Started
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-color-600 md:mt-0">
                    <DateS
                      date={session.startedAt}
                      options={{ dateStyle: "short", timeStyle: "short" }}
                    />
                  </div>
                </li>
              )}
              {session.completedAt && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-color-900">
                    Completed
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-color-600 md:mt-0">
                    <DateS
                      date={session.completedAt}
                      options={{ dateStyle: "short", timeStyle: "short" }}
                    />
                  </div>
                </li>
              )}
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-color-900">
                  Created by
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-color-600 md:mt-0">
                  <UserBadge
                    name={
                      session.createdBy?.firstName &&
                      session.createdBy?.lastName
                        ? `${session.createdBy.firstName} ${session.createdBy.lastName}`
                        : session.createdBy?.email || "Unknown"
                    }
                    img={
                      session.createdBy?.profilePicture ||
                      "/static/images/default_pfp.jpg"
                    }
                  />
                </div>
              </li>
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-color-900">
                  Assigned to
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-color-600 md:mt-0">
                  <div className="flex flex-col gap-2">
                    {assignedUsers.length > 0 ? (
                      assignedUsers.map((assignment) => (
                        <UserBadge
                          key={assignment.id}
                          name={
                            assignment.user?.firstName &&
                            assignment.user?.lastName
                              ? `${assignment.user.firstName} ${assignment.user.lastName}`
                              : assignment.user?.email || "Unknown"
                          }
                          img={
                            assignment.user?.profilePicture ||
                            "/static/images/default_pfp.jpg"
                          }
                        />
                      ))
                    ) : (
                      <span className="flex items-center gap-1">
                        Not assigned
                        <InfoTooltip
                          iconClassName="size-4"
                          content={
                            <p className="text-sm text-color-600">
                              Any user with access can perform this audit
                              because it has no specific assignee.
                            </p>
                          }
                        />
                      </span>
                    )}
                  </div>
                </div>
              </li>
            </ul>
          </Card>
        </div>

        {/* Right Column: Audit Images */}
        <div className="flex-1">
          <h2 className="mb-4 text-lg font-semibold">
            Audit Images{" "}
            <InfoTooltip
              iconClassName="size-4"
              content={
                <p className="mb-3 text-sm text-color-600">
                  Images captured during the audit. General images are
                  associated with the audit itself, while asset images are
                  linked to specific assets.
                </p>
              }
            />
          </h2>

          {/* General Audit Images */}
          {generalImages.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-color-700">
                <span className="flex size-5 items-center justify-center rounded bg-primary-50 text-xs text-primary-600">
                  {generalImages.length}
                </span>
                General Audit Images
              </h3>
              <Card className="mt-0 md:border">
                <div className="flex flex-wrap gap-3">
                  {generalImages.map((image) => (
                    <ImageWithPreview
                      key={image.id}
                      imageUrl={image.imageUrl}
                      thumbnailUrl={image.thumbnailUrl}
                      alt={image.description || "General audit image"}
                      withPreview
                      className="size-24 rounded border"
                      images={generalImages.map((img) => ({
                        id: img.id,
                        imageUrl: img.imageUrl,
                        thumbnailUrl: img.thumbnailUrl,
                        alt: img.description || "General audit image",
                      }))}
                      currentImageId={image.id}
                    />
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* Asset-Specific Images */}
          {assetImages.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-color-700">
                <span className="flex size-5 items-center justify-center rounded bg-blue-50 text-xs text-blue-600">
                  {assetImages.length}
                </span>
                Asset-Specific Images
              </h3>
              <Card className="mt-0 md:border">
                <div className="flex flex-wrap gap-3">
                  {assetImages.map((image) => (
                    <ImageWithPreview
                      key={image.id}
                      imageUrl={image.imageUrl}
                      thumbnailUrl={image.thumbnailUrl}
                      // Show asset title in the preview header for context.
                      alt={
                        image.auditAsset?.asset?.title
                          ? `Asset: ${image.auditAsset.asset.title}`
                          : image.description || "Asset image"
                      }
                      withPreview
                      className="size-24 rounded border"
                      images={assetImages.map((img) => ({
                        id: img.id,
                        imageUrl: img.imageUrl,
                        thumbnailUrl: img.thumbnailUrl,
                        alt: img.auditAsset?.asset?.title
                          ? `Asset: ${img.auditAsset.asset.title}`
                          : img.description || "Asset image",
                      }))}
                      currentImageId={image.id}
                    />
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* No Images State */}
          {generalImages.length === 0 && assetImages.length === 0 && (
            <Card className="mt-0 md:border">
              <div className="px-4 py-6 text-center text-sm text-color-500">
                No images uploaded
              </div>
            </Card>
          )}
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
            "left-of-search": (
              <AuditStatusFilter statusItems={AUDIT_STATUS_ITEMS} />
            ),
          }}
        />
        <List
          ItemComponent={AssetListItem}
          customEmptyStateContent={filterMetadata.emptyState}
          bulkActions={canRemoveAssets ? <BulkActionsDropdown /> : undefined}
          headerChildren={
            <>
              {showAuditStatusColumn && (
                <Th className="whitespace-nowrap">Audit Status</Th>
              )}
              <Th>Location</Th>
              <CustodianHeader />
              <Th>Category</Th>
              <Th>Tags</Th>
              {canRemoveAssets && <Th className="w-[60px]" />}
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
  const { session, canRemoveAssets } = useLoaderData<typeof loader>();
  const { category, location, custody } = item;
  const [searchParams] = useSearchParams();
  const currentFilter = searchParams.get("auditStatus");
  const { roles } = useUserRoleHelper();

  // Show audit status column when "ALL" or "EXPECTED" filter is active
  const showAuditStatus =
    currentFilter === null ||
    currentFilter === "ALL" ||
    currentFilter === "EXPECTED";
  const isAuditCompleted = session.status === "COMPLETED";
  const auditStatusLabel = getAuditStatusLabel(
    item.auditData,
    isAuditCompleted
  );

  const canReadCustody = userHasPermission({
    roles,
    entity: PermissionEntity.custody,
    action: PermissionAction.read,
  });

  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4 md:justify-normal md:px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex size-10 shrink-0  justify-center">
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
                  className="text-left font-medium text-color-900 hover:text-color-700"
                  target="_blank"
                  onlyNewTabIconOnHover
                >
                  {item.title}
                </Button>
              </span>
            </div>
          </div>
        </div>
      </Td>
      {showAuditStatus && (
        <Td>
          <AuditAssetStatusBadge status={auditStatusLabel} />
        </Td>
      )}
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
      {canReadCustody && (
        <Td>
          {custody?.custodian ? (
            <TeamMemberBadge teamMember={custody.custodian} />
          ) : (
            <EmptyTableValue />
          )}
        </Td>
      )}
      <Td>
        {category ? <CategoryBadge category={category} /> : <EmptyTableValue />}
      </Td>
      <Td>
        <ListItemTagsColumn tags={item.tags} />
      </Td>
      {canRemoveAssets && (
        <Td className="text-right">
          <AuditAssetRowActionsDropdown
            auditAssetId={item.auditData?.auditAssetId || ""}
            assetTitle={item.title}
          />
        </Td>
      )}
    </>
  );
}

function ClearFilterButton() {
  const [, setSearchParams] = useSearchParams();

  const handleClick = () => {
    setSearchParams((prev) => {
      prev.delete("auditStatus");
      return prev;
    });
  };

  return (
    <Button variant="link-gray" className="text-sm " onClick={handleClick}>
      View all
    </Button>
  );
}

function CustodianHeader() {
  const { roles } = useUserRoleHelper();
  const canReadCustody = userHasPermission({
    roles,
    entity: PermissionEntity.custody,
    action: PermissionAction.read,
  });

  if (!canReadCustody) return null;

  return (
    <Th>
      <div className="flex items-center gap-1">
        Custodian
        <InfoTooltip
          iconClassName="size-4"
          content="The team member currently in custody of this asset."
        />
      </div>
    </Th>
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
          ? "border-color-900 bg-color-900 text-white"
          : "border-color-200 bg-surface text-color-900 hover:border-color-300"
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
    </button>
  );
}
