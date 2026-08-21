import { OrganizationRoles } from "@prisma/client";
import {
  AUDIT_ASSET_STATUS_LABELS,
  AUDIT_UNASSIGNED_LABELS,
  auditAssetStatusLabel,
  isAuditCompleted,
} from "@shelf/labels";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, redirect, useLoaderData } from "react-router";
import { z } from "zod";

import { AuditAssetListItem } from "~/components/audit/audit-asset-list-item";
import { AuditStatusBadgeWithOverdue } from "~/components/audit/audit-status-badge-with-overdue";
import { AuditStatusFilter } from "~/components/audit/audit-status-filter";
import BulkActionsDropdown from "~/components/audit/bulk-actions-dropdown";
import { BulkRemoveAssetsFromAuditSchema } from "~/components/audit/bulk-remove-assets-from-audit-dialog";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { MarkdownViewer } from "~/components/markdown/markdown-viewer";
import { Button } from "~/components/shared/button";
import { Card } from "~/components/shared/card";
import { DateS } from "~/components/shared/date";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { UserBadge } from "~/components/shared/user-badge";
import { Th } from "~/components/table";
import { db } from "~/database/db.server";
import { useSearchParams } from "~/hooks/search-params";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getAuditFilterMetadata } from "~/modules/audit/audit-filter-utils";
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
import { resolveUserDisplayName } from "~/utils/user";

const label = "Audit";

/**
 * Audit-status filter options: URL value -> the words the user reads.
 *
 * MISSING is completion-aware for the same reason the statistics tile is —
 * an expected asset is only "missing" once the audit is closed. Keys stay the
 * enum names so existing filtered links keep working.
 */
function buildAuditStatusItems(auditIsCompleted: boolean) {
  return {
    EXPECTED: "Expected",
    FOUND: AUDIT_ASSET_STATUS_LABELS.FOUND,
    MISSING: auditAssetStatusLabel("PENDING", auditIsCompleted),
    UNEXPECTED: AUDIT_ASSET_STATUS_LABELS.UNEXPECTED,
  };
}

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

    /**
     * The condition notes people wrote during the audit.
     *
     * why this page had none: every photo taken during an audit was already
     * on this page, grouped and labelled with its asset, while the words
     * written beside those photos appeared nowhere. Reading them meant
     * opening rows one at a time, or scrolling the Activity feed where they
     * sit among system rows. The written observation is the half that says
     * "already scratched when it went out", so it is the half worth surfacing.
     *
     * COMMENT only: UPDATE rows are the system trail, stored as Markdoc
     * source, and belong to the Activity tab.
     */
    const conditionNotes = await db.auditNote.findMany({
      where: { auditSessionId: auditId, type: "COMMENT" },
      select: {
        id: true,
        content: true,
        createdAt: true,
        user: {
          select: {
            // `displayName` first: `resolveUserDisplayName` prefers it, and an
            // SSO account often carries only that. Selecting just first/last
            // renders those people as "Unknown" here while the PDF, which uses
            // the same resolver over a fuller select, names them.
            displayName: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
        auditAsset: {
          select: { asset: { select: { id: true, title: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });

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
        conditionNotes,
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

    /**
     * Intents whose own authorization rule is BROADER than assignment, and so
     * must not sit behind the assignment guard.
     *
     * `cancel-audit` is the only one today. `createAuditSession` does NOT
     * auto-assign the creator, while `cancelAuditSession` guarantees the
     * creator may always cancel — so gating it on assignment would lock a
     * BASE creator out of an audit they made themselves. The narrower
     * creator-or-admin rule inside the service is the correct gate there.
     */
    const INTENTS_WITH_THEIR_OWN_RULE = new Set(["cancel-audit"]);

    // Assignee-gated by DEFAULT: ADMIN/OWNER may act on any audit,
    // BASE/SELF_SERVICE only on audits assigned to them.
    //
    // Expressed as an exclusion rather than a list of guarded intents so the
    // default is fail-closed — a newly added intent inherits the guard instead
    // of silently escaping it. Only `complete-audit` used to carry a check, so
    // `remove-asset` and `bulk-remove-assets` let an unassigned member strip
    // assets out of anyone's audit by direct POST; the loader's
    // `canRemoveAssets` is display-only. (detail.dev D101)
    if (!INTENTS_WITH_THEIR_OWN_RULE.has(String(intent))) {
      await requireAuditAssignee({
        auditSessionId: auditId,
        organizationId,
        userId,
        isSelfServiceOrBase,
      });
    }

    if (intent === "complete-audit") {
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
        // Admin/owner is the inverse of self-service/base in this codebase.
        // Allows non-creator admin/owners to cancel team-managed audits.
        isAdminOrOwner: !isSelfServiceOrBase,
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

// react-doctor:no-giant-component — deferred for follow-up refactor
export default function AuditOverview() {
  const {
    session,
    totalItems,
    generalImages,
    assetImages,
    conditionNotes,
    canRemoveAssets,
  } = useLoaderData<typeof loader>();

  /**
   * One entry per asset somebody recorded something about, holding BOTH the
   * words and the photographs.
   *
   * why merged: a note about the Laerdal and a photo of the Laerdal are one
   * observation. Splitting them into a notes list and a photo wall makes the
   * reader join them up by asset name, which is work this page should do.
   */
  const findings = (() => {
    const groups = new Map<
      string,
      {
        assetName: string;
        images: typeof assetImages;
        notes: typeof conditionNotes;
      }
    >();

    const groupFor = (assetId: string, assetName: string) => {
      if (!groups.has(assetId)) {
        groups.set(assetId, { assetName, images: [], notes: [] });
      }
      return groups.get(assetId)!;
    };

    for (const img of assetImages) {
      const asset = img.auditAsset?.asset;
      if (!asset?.id) continue;
      groupFor(asset.id, asset.title || "Unknown").images.push(img);
    }
    for (const note of conditionNotes) {
      const asset = note.auditAsset?.asset;
      if (!asset?.id) continue;
      groupFor(asset.id, asset.title || "Unknown").notes.push(note);
    }

    return [...groups.entries()].sort((a, b) =>
      a[1].assetName.localeCompare(b[1].assetName)
    );
  })();

  /** Notes about the audit as a whole — the completion note lives here. */
  const generalNotes = conditionNotes.filter(
    (note) => !note.auditAsset?.asset?.id
  );

  const hasFindings =
    findings.length > 0 || generalNotes.length > 0 || generalImages.length > 0;
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
  // why: `missingAssetCount` is seeded with the FULL expected count when the
  // audit is created and only decrements as assets are found, so before the
  // audit is completed it is the not-yet-scanned count, not a missing count.
  // Labelling it "Missing" told users a brand-new audit was already missing
  // every one of its assets. The asset rows have always been completion-aware
  // (getAuditStatusLabel); this makes the tile agree with them.
  // The `completedAt`-not-`status` rule lives in `@shelf/labels` so every
  // surface in both apps derives it identically — see `isAuditCompleted`.
  const auditIsCompleted = isAuditCompleted(session);
  const unscannedLabel = auditAssetStatusLabel("PENDING", auditIsCompleted);
  const unexpectedCount = session.unexpectedAssetCount || 0;

  const filterMetadata = getAuditFilterMetadata(
    currentFilter,
    auditIsCompleted
  );

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
              label={AUDIT_ASSET_STATUS_LABELS.FOUND}
              value={foundCount}
              filterType="FOUND"
              isActive={currentFilter === "FOUND"}
            />
            <StatCard
              label={unscannedLabel}
              value={missingCount}
              filterType="MISSING"
              isActive={currentFilter === "MISSING"}
            />
            <StatCard
              label={AUDIT_ASSET_STATUS_LABELS.UNEXPECTED}
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
                  <AuditStatusBadgeWithOverdue
                    status={session.status}
                    dueDate={session.dueDate}
                  />
                </div>
              </li>
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-gray-900">
                  Created
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                  <DateS date={session.createdAt} includeTime />
                </div>
              </li>
              {session.dueDate && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-gray-900">
                    Due date
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                    <DateS date={session.dueDate} includeTime />
                  </div>
                </li>
              )}
              {session.startedAt && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-gray-900">
                    Started
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                    <DateS date={session.startedAt} includeTime />
                  </div>
                </li>
              )}
              {session.completedAt && (
                <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                  <span className="w-2/5 text-[14px] font-medium text-gray-900">
                    Completed
                  </span>
                  <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                    <DateS date={session.completedAt} includeTime />
                  </div>
                </li>
              )}
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-gray-900">
                  Created by
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                  <UserBadge
                    name={
                      resolveUserDisplayName(session.createdBy) ||
                      session.createdBy?.email ||
                      "Unknown"
                    }
                    img={
                      session.createdBy?.profilePicture ||
                      "/static/images/default_pfp.jpg"
                    }
                  />
                </div>
              </li>
              <li className="w-full border-b-[1.1px] border-b-gray-100 p-4 last:border-b-0 md:flex">
                <span className="w-2/5 text-[14px] font-medium text-gray-900">
                  Assigned to
                </span>
                <div className="mt-1 w-3/5 text-[14px] text-gray-600 md:mt-0">
                  <div className="flex flex-col gap-2">
                    {assignedUsers.length > 0 ? (
                      assignedUsers.map((assignment) => (
                        <UserBadge
                          key={assignment.id}
                          name={
                            resolveUserDisplayName(assignment.user) ||
                            assignment.user?.email ||
                            "Unknown"
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
                            <p className="text-sm text-gray-600">
                              {AUDIT_UNASSIGNED_LABELS.DETAIL}
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

        {/*
          Right column: FINDINGS — what people recorded, grouped by the asset
          they recorded it about, words and photographs together.

          why this replaced "Audit Images": every photo taken during an audit
          was already here, grouped and labelled. The notes written beside
          those photos were on no page at all — reachable only by opening rows
          one at a time, or by scrolling the Activity feed where they sit among
          system rows. The written observation is the half that answers "was it
          already damaged when it went out", so leaving it off the audit's own
          page was the real gap. A note and a photo of the same asset are one
          observation and now print as one.
        */}
        <div className="flex-1">
          <h2 className="mb-4 text-lg font-semibold">
            Findings{" "}
            <InfoTooltip
              iconClassName="size-4"
              content={
                <p className="mb-3 text-sm text-gray-600">
                  The condition notes and photos people recorded while auditing,
                  grouped by the asset they were recorded against. Notes about
                  the audit itself, such as a completion note, appear first.
                  System activity lives on the Activity tab.
                </p>
              }
            />
          </h2>

          {/* About the audit as a whole */}
          {(generalNotes.length > 0 || generalImages.length > 0) && (
            <div className="mb-4">
              <h3 className="mb-2 text-sm font-medium text-gray-700">
                About this audit
              </h3>
              <Card className="mt-0 md:border">
                {generalNotes.map((note) => (
                  <div key={note.id} className="mb-3 last:mb-0">
                    {/* Audit notes are Markdoc source, not plain text: the
                        completion note carries `**bold**` stats, a receipt
                        link, and an `{% audit_images %}` tag. Rendering the
                        string directly prints that source to the reader.
                        `allowExternalLinks` stays false here — this bucket is
                        where the SYSTEM-composed completion note lands, and
                        only notes a person authored through the editor may
                        link off-origin. */}
                    <div className="text-sm text-gray-900">
                      <MarkdownViewer content={note.content} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {resolveUserDisplayName(note.user) || "Unknown"} &middot;{" "}
                      <DateS date={note.createdAt} includeTime />
                    </p>
                  </div>
                ))}

                {generalImages.length > 0 && (
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
                )}
              </Card>
            </div>
          )}

          {/* One block per asset somebody recorded something about */}
          {findings.length > 0 && (
            <div className="mb-4 flex flex-col gap-3">
              {findings.map(([assetId, { assetName, images, notes }]) => (
                <Card key={assetId} className="mt-0 md:border">
                  <h3 className="mb-2 text-sm font-medium text-gray-900">
                    {assetName}
                  </h3>

                  {notes.map((note) => (
                    <div key={note.id} className="mb-3">
                      {/* Condition notes are authored through the editor, so
                          they may link out — same treatment the details panel
                          gives these exact rows. */}
                      <div className="text-sm text-gray-900">
                        <MarkdownViewer
                          content={note.content}
                          allowExternalLinks
                        />
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {resolveUserDisplayName(note.user) || "Unknown"}{" "}
                        &middot; <DateS date={note.createdAt} includeTime />
                      </p>
                    </div>
                  ))}

                  {images.length > 0 && (
                    <div className="flex flex-wrap gap-3">
                      {images.map((image) => (
                        <ImageWithPreview
                          key={image.id}
                          imageUrl={image.imageUrl}
                          thumbnailUrl={image.thumbnailUrl}
                          alt={`Photo of ${assetName}`}
                          withPreview
                          className="size-24 rounded border"
                          images={images.map((img) => ({
                            id: img.id,
                            imageUrl: img.imageUrl,
                            thumbnailUrl: img.thumbnailUrl,
                            alt: `Photo of ${assetName}`,
                          }))}
                          currentImageId={image.id}
                        />
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}

          {/* Nothing recorded */}
          {!hasFindings && (
            <Card className="mt-0 md:border">
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                Nothing was recorded during this audit
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
              <AuditStatusFilter
                statusOptions={buildAuditStatusItems(auditIsCompleted)}
              />
            ),
          }}
        />
        <List
          ItemComponent={AuditAssetListItem}
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

// The audit asset row was extracted to its own component —
// `~/components/audit/audit-asset-list-item.tsx` (imported as
// `AuditAssetListItem` and passed to `List`). The previously-inline
// `AssetListItem` body that lived here is removed in favour of the
// extracted component so the route has one source of truth.
function ClearFilterButton() {
  const [, setSearchParams] = useSearchParams();

  const handleClick = () => {
    setSearchParams((prev) => {
      prev.delete("auditStatus");
      return prev;
    });
  };

  return (
    <Button
      type="button"
      variant="link-gray"
      className="text-sm "
      onClick={handleClick}
    >
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
          ? "border-gray-900 bg-gray-900 text-white"
          : "border-gray-200 bg-white text-gray-900 hover:border-gray-300"
      )}
    >
      <div className="text-sm font-medium">{label}</div>
      <div className="mt-1 text-3xl font-bold">{value}</div>
    </button>
  );
}
