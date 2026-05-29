/**
 * AuditAssetListItem
 *
 * Row component for the audit overview's expected-assets table. Extracted
 * from the audit overview route (`audits.$auditId.overview.tsx`) to keep
 * the route file under the react-doctor giant-component threshold.
 *
 * Behaviour is unchanged — pure extraction. The component uses
 * `useLoaderData<typeof loader>()` of the source route, so it must only
 * be rendered from within that route's subtree.
 *
 * @see {@link file://./../../routes/_layout+/audits.$auditId.overview.tsx}
 */

import { useLoaderData } from "react-router";

import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { AssetImage } from "~/components/assets/asset-image";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import { AuditAssetRowActionsDropdown } from "~/components/audit/audit-asset-row-actions-dropdown";
import { AuditAssetStatusBadge } from "~/components/audit/audit-asset-status-badge";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { Td } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import { useSearchParams } from "~/hooks/search-params";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAuditStatusLabel } from "~/modules/audit/audit-filter-utils";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { getPrimaryCustody } from "~/modules/custody/utils";
import type { loader } from "~/routes/_layout+/audits.$auditId.overview";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";

/** Loader response shape for the audit overview route. */
type LoaderData = Awaited<ReturnType<typeof loader>>;

/** Single expected-asset row item, as returned by the audit overview loader. */
type AuditAssetItem = LoaderData["data"]["items"][number];

/**
 * Single row in the audit's expected-assets table.
 *
 * Renders the asset's identity (image, name, display code chip), audit
 * status, location, custodian, category, tags, and (when permitted) a
 * row-level actions dropdown.
 *
 * @param props.item - The audit-asset row data from the loader.
 */
export function AuditAssetListItem({ item }: { item: AuditAssetItem }) {
  const { session, canRemoveAssets } = useLoaderData<typeof loader>();
  const { category, location, custody: custodyArray } = item;
  // `custody` is an array on the quantities data model — surface the primary
  // custody row so the existing single-custodian badge keeps working.
  const custody = getPrimaryCustody(custodyArray);
  const [searchParams] = useSearchParams();
  const currentFilter = searchParams.get("auditStatus");
  const { roles } = useUserRoleHelper();
  const currentOrganization = useCurrentOrganization();
  // Resolve the asset's display code. Audits run on physical assets, so this
  // is the strongest case for the badge — the field worker matches the label
  // on their hand to a row on screen.
  const displayCode = currentOrganization
    ? resolveDisplayCode({ entity: item, organization: currentOrganization })
    : null;

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
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                  target="_blank"
                  onlyNewTabIconOnHover
                >
                  {item.title}
                </Button>
              </span>
              {/*
                Code chip metadata row — same flex-wrap container shape as
                every other list surface, even though this surface has no
                companion items in the name cell (status lives in its own
                column). Keeps composition consistent across surfaces per
                `.claude/rules/code-bearing-entity-list-consistency.md`.
              */}
              {displayCode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <AssetCodeBadge {...displayCode} />
                </div>
              ) : null}
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
