/**
 * Asset Model Assets API
 *
 * Returns the assets of one asset model, narrowed by the filters the asset
 * index is currently showing. Backs the model view's drill-down sheet, which
 * loads lazily because a model can hold hundreds of assets and a page shows
 * many models.
 *
 * The caller forwards its own search string verbatim under a `filters` query
 * param; this route strips the params that describe the MODEL view (they mean
 * nothing to an asset list) and appends a synthetic `assetModel is <id>`
 * filter. Reusing the caller's string rather than rebuilding filters here is
 * what keeps the sheet's contents and the row's count in agreement — see the
 * sheet/badge invariant at the drill-down sheet component.
 *
 * @see {@link file://./../../components/assets/assets-index/asset-model-assets-sheet.tsx}
 */
import { OrganizationRoles } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import { getAdvancedPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getClientHint } from "~/utils/client-hints";
import { redactCustodianForViewer } from "~/utils/custody-visibility.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

/**
 * Query params that describe the MODEL view's own paging/sorting and mean
 * nothing to an asset list — dropped from the forwarded filter string so a
 * model-rollup page number or model sort key never leaks into the drill-down
 * (a model's assets and the model rollup paginate independently; reusing the
 * rollup's `page` would point the asset list at an unrelated page).
 */
const VIEW_SCOPED_PARAMS = [
  "view",
  "modelSortBy",
  "modelSortDirection",
  "page",
];

/**
 * Serializes filter params back to this app's filter-string convention
 * (`key=operator:value`, e.g. `status=is:AVAILABLE` — see the `parseFilters`
 * docstring in `filter-parsing.ts`).
 *
 * `URLSearchParams#toString()` percent-encodes the operator colon as `%3A`.
 * `parseFilters` still decodes that back correctly (its `forEach` yields
 * decoded values), so this is not a correctness bug — but the resulting
 * string no longer looks like any other filter string in the app, which
 * trips up anything that inspects it directly. Escaping manually keeps the
 * colon literal while still escaping everything else a value can legitimately
 * contain (`&`, `=`, unicode, …).
 */
function stringifyFilters(params: URLSearchParams): string {
  const parts: string[] = [];
  params.forEach((value, key) => {
    parts.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(value).replace(
        /%3A/g,
        ":"
      )}`
    );
  });
  return parts.join("&");
}

/**
 * Loader for `GET /api/asset-models/:assetModelId/assets`.
 *
 * Proves the model belongs to the caller's organization before it reaches
 * any query (`assetModelId` is request input), then reruns the advanced
 * index query with the caller's own filters plus a synthetic filter pinning
 * the result to this model.
 *
 * @throws {ShelfError} 404 if the model does not exist in the caller's organization.
 */
export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { assetModelId } = getParams(
    params,
    z.object({ assetModelId: z.string().min(1) })
  );

  try {
    const { organizationId, role, canUseBarcodes, canSeeAllCustody } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      });

    // The model id is request input: prove it belongs to the caller's
    // organization before it reaches a query. A cross-org id 404s rather
    // than leaking whether it exists elsewhere.
    const assetModel = await db.assetModel.findFirst({
      where: { id: assetModelId, organizationId },
      select: { id: true, name: true },
    });

    if (!assetModel) {
      throw new ShelfError({
        cause: null,
        message: "Asset model not found.",
        additionalData: { assetModelId, organizationId },
        label: "Assets",
        status: 404,
        shouldBeCaptured: false,
      });
    }

    const url = new URL(request.url);
    // The caller's own search string arrives decoded, inside the `filters`
    // param — re-parse it as a query string of its own.
    const forwarded = new URLSearchParams(
      url.searchParams.get("filters") ?? ""
    );
    VIEW_SCOPED_PARAMS.forEach((param) => forwarded.delete(param));
    // `is:<id>` is the operator `generateWhereClause`'s assetModel branch
    // expects (see query.server.ts) — anything else silently matches nothing.
    forwarded.set("assetModel", `is:${assetModel.id}`);

    const settings = await getAssetIndexSettings({
      userId,
      organizationId,
      canUseBarcodes,
      role,
    });

    // Built-in date filters truncate to a calendar day in the acting user's
    // zone, and the filter string carries the date but not the zone it must be
    // read in. Resolving it the way the index loader does is what keeps this
    // sheet's contents equal to the count on the row that opened it.
    const { timeZone } = await resolveUserFormatPrefsById(
      userId,
      getClientHint(request)
    );

    const { assets, totalAssets, page, perPage, totalPages } =
      await getAdvancedPaginatedAndFilterableAssets({
        request,
        organizationId,
        settings,
        filters: stringifyFilters(forwarded),
        canUseBarcodes,
        timeZone,
        // Matches the index loader (data.server.ts) so a SELF_SERVICE viewer
        // sees the same restricted set here as on the page that opened the
        // sheet — this endpoint is reachable directly, not only through it.
        availableToBookOnly: role === OrganizationRoles.SELF_SERVICE,
      });

    // Empties custodian identities the viewer isn't allowed to see, same as
    // the index loader — Prisma's `select` can't vary per row, so every row
    // ships the custodian unconditionally and redaction has to happen here,
    // after the query and before the payload leaves this loader. Without it,
    // a restricted role's "private" badge in the UI is cosmetic: this
    // endpoint's raw response already carries the name and email.
    const redactedAssets = redactCustodianForViewer(assets, {
      canSeeAllCustody,
      userId,
    });

    return data(
      payload({
        assets: redactedAssets,
        totalAssets,
        page,
        perPage,
        totalPages,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, assetModelId });
    throw data(error(reason), { status: reason.status });
  }
}
