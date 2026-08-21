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

import { isAuditCompleted } from "@shelf/labels";
import { ImageIcon, MessageSquare } from "lucide-react";
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
  /**
   * What a person recorded against this asset, kept as TWO numbers.
   *
   * why not one summed number: it would not be comparable between rows. Two
   * photos uploaded with a caption store one COMMENT plus two images; the
   * same two photos with no caption store an UPDATE plus two images, and
   * UPDATE rows are not evidence and are not counted (helpers.server.ts,
   * createAuditImageEvidenceNote). A single digit would therefore read 3 or 2
   * for identical evidence, tracking how the upload happened to be stored
   * rather than what was found. Every destination keeps them apart too — the
   * panel this links to has a Notes badge and an Images badge, and the phone
   * sheet has a notes section and a photo grid.
   */
  const noteCount = item.auditData?.auditNotesCount ?? 0;
  const photoCount = item.auditData?.auditImagesCount ?? 0;
  const hasEvidence = noteCount > 0 || photoCount > 0;

  /** Reads the way a person would say it, for screen readers and the tooltip. */
  const evidenceLabel = [
    noteCount > 0 ? `${noteCount} ${noteCount === 1 ? "note" : "notes"}` : null,
    photoCount > 0
      ? `${photoCount} ${photoCount === 1 ? "photo" : "photos"}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");
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
    ? resolveDisplayCode({
        entity: item,
        organization: currentOrganization,
        entityKind: "asset",
      })
    : null;

  // Show audit status column when "ALL" or "EXPECTED" filter is active
  const showAuditStatus =
    currentFilter === null ||
    currentFilter === "ALL" ||
    currentFilter === "EXPECTED";
  // why: the shared `completedAt` rule, NOT `status === "COMPLETED"`. Archiving
  // a completed audit rewrites the status while keeping the timestamp, so the
  // status check made these rows read "Not scanned" beside a tile still saying
  // "Missing" — the same divergence this PR removes elsewhere.
  const auditStatusLabel = getAuditStatusLabel(
    item.auditData,
    isAuditCompleted(session)
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
                  assetModel: item.assetModel ?? null,
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
              {displayCode || hasEvidence ? (
                <div className="flex flex-wrap items-center gap-2">
                  {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
                  {/*
                    why: the row is the only place someone looks when asking
                    "which of these did we find something on?". The notes and
                    photos were always reachable — through the Activity feed,
                    or by opening a row on spec — but nothing here said which
                    rows were worth opening, so on a large audit the one
                    damaged item read exactly like the clean ones.

                    Links into the existing notes-and-images panel rather than
                    introducing a second place to read evidence. That panel has
                    no status gate, so this works on a completed audit, which
                    is when the record actually gets consulted.
                  */}
                  {hasEvidence && item.auditData?.auditAssetId ? (
                    <Button
                      to={`/audits/${session.id}/scan/${item.auditData.auditAssetId}/details`}
                      variant="link"
                      className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[12px] font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900"
                      title={`${evidenceLabel} on ${item.title}`}
                      aria-label={`${evidenceLabel} on ${item.title}`}
                    >
                      {/* why these two glyphs: they are the ones the
                          destination panel already heads its Notes and Images
                          sections with, so the row and the panel teach one
                          vocabulary instead of two. */}
                      {noteCount > 0 ? (
                        <span className="flex items-center gap-1">
                          <MessageSquare className="size-3" aria-hidden />
                          <span className="tabular-nums">{noteCount}</span>
                        </span>
                      ) : null}
                      {photoCount > 0 ? (
                        <span className="flex items-center gap-1">
                          <ImageIcon className="size-3" aria-hidden />
                          <span className="tabular-nums">{photoCount}</span>
                        </span>
                      ) : null}
                    </Button>
                  ) : null}
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
