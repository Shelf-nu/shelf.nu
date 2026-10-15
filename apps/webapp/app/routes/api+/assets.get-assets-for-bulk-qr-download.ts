import { data, type ActionFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import { resolveAssetIdsForBulkOperation } from "~/modules/asset/bulk-operations-helper.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { generateQrObj } from "~/modules/qr/utils.server";
import { scopeCustodianFilterIds } from "~/modules/team-member/service.server";
import { getClientHint } from "~/utils/client-hints";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import { ALL_SELECTED_KEY } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export type BulkQrDownloadLoaderData = {
  assets: Array<{
    id: string;
    title: string;
    sequentialId: string | null;
    createdAt: Date;
    qr: {
      id: string;
      src: string;
      size: "small" | "cable" | "medium" | "large";
    };
  }>;
  qrIdDisplayPreference: string;
  showShelfBranding: boolean;
};

/**
 * This API find all/some assets in current organization and returns the required data
 * for generating qr codes after validation.
 */
export async function loader({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const {
      organizationId,
      currentOrganization,
      access,
      canUseBarcodes,
      role,
    } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.qr,
      action: PermissionAction.read,
    });

    const url = new URL(request.url);
    const searchParams = url.searchParams;

    const assetIds = searchParams.getAll("assetIds");

    if (assetIds.length === 0) {
      throw new ShelfError({
        cause: null,
        status: 400,
        message: "No asset id provided.",
        shouldBeCaptured: false,
        label: "Assets",
      });
    }

    /**
     * "Select all" resolves through the bulk helper, which reads the member's
     * saved index mode: in advanced mode the URL carries filter syntax such as
     * `status=is:AVAILABLE`, which only the advanced filter parser understands.
     */
    let resolvedIds = assetIds;
    if (assetIds.includes(ALL_SELECTED_KEY)) {
      const savedSettings = await getAssetIndexSettings({
        userId,
        organizationId,
        canUseBarcodes,
        role,
      });
      /**
       * Advanced filtering is a per-role capability, and the saved mode can
       * outlive it (a demoted member keeps ADVANCED until they next open
       * /assets). Advanced search also matches custodian names, so a role
       * without the capability always resolves in simple mode.
       */
      const settings = access.policy.ui.advancedAssetIndex
        ? savedSettings
        : { ...savedSettings, mode: "SIMPLE" as const };
      // Date filters truncate the day in the member's own time zone.
      const { timeZone } = await resolveUserFormatPrefsById(
        userId,
        getClientHint(request)
      );

      resolvedIds = await resolveAssetIdsForBulkOperation({
        assetIds,
        organizationId,
        currentSearchParams: searchParams.toString(),
        settings,
        timeZone,
        /**
         * `qr: read` is held by BASE and SELF_SERVICE, so this endpoint is
         * reachable by roles that may not see other people's custody. An
         * unscoped custodian filter would list exactly which assets a named
         * colleague holds, ignoring `baseUserCanSeeCustody`.
         */
        allowedTeamMemberIds: await scopeCustodianFilterIds({
          teamMemberIds: searchParams.getAll("teamMember"),
          canSeeAllCustody: access.custody.seeAll,
          userId,
          organizationId,
        }),
        // The Archived / All views are for members who may see archived
        // assets (`assets.seeArchived`, issue #382); anyone else downloads
        // the codes of active assets, whatever the URL says.
        honorArchivedView: access.policy.assets.seeArchived,
      });
    }

    if (resolvedIds.length > 100) {
      throw new ShelfError({
        cause: null,
        label: "Assets",
        status: 400,
        shouldBeCaptured: false,
        message:
          "Bulk downloading QR codes is only available for maximum 100 codes at a time. Please select less codes to download.",
      });
    }

    const assets = await db.asset.findMany({
      // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: ids are already resolved; select-all honours the archived view above, and an explicit selection may print an archived asset's label
      where: { id: { in: resolvedIds }, organizationId },
      select: { id: true, title: true, createdAt: true, sequentialId: true },
    });

    /**
     * Every code in one read rather than one read per asset. Assets that
     * already have a code — which is all of them, in the normal case — then
     * need no database work at all, and only the rare asset without one pays
     * for the locked create inside `generateQrObj`.
     */
    const existingQrs = await db.qr.findMany({
      where: { assetId: { in: assets.map((asset) => asset.id) } },
    });
    const qrByAssetId = new Map(
      existingQrs.map((qr) => [qr.assetId, qr] as const)
    );

    const assetsWithQrObj = [];

    for (const asset of assets) {
      const qrObj = await generateQrObj({
        assetId: asset.id,
        organizationId,
        userId,
        // `null` rather than `undefined`: the read above is authoritative, so
        // a miss means "create one", not "look again".
        existingQr: qrByAssetId.get(asset.id) ?? null,
      });

      assetsWithQrObj.push({
        ...asset,
        qr: qrObj.qr,
      });
    }

    return data(
      payload({
        assets: assetsWithQrObj,
        qrIdDisplayPreference: currentOrganization.qrIdDisplayPreference,
        showShelfBranding: currentOrganization.showShelfBranding,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
