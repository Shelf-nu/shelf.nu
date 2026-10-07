/**
 * Asset Model Bucket Assets
 *
 * The read behind the model view's drill-down sheet, shared by both endpoints
 * that expose it: `/api/asset-models/:assetModelId/assets` for a real model,
 * and `/api/asset-models/unassigned-assets` for the "No model" bucket. Only
 * the predicate differs between them, so only the predicate is passed in.
 *
 * It lives here rather than in either route because almost everything around
 * that predicate is a guard: the permission gate, the organization scope, the
 * `availableToBookOnly` narrowing a viewer limited to bookable assets gets, and the custodian
 * redaction applied before the payload leaves. Two routes each carrying their
 * own copy of that stack is how one of them ends up missing a guard, which on
 * this endpoint exposes data rather than merely looking wrong.
 *
 * The caller forwards its own search string verbatim under a `filters` query
 * param. This module strips the params that describe the MODEL view (they mean
 * nothing to an asset list) and adds the bucket's predicate. Reusing the
 * caller's string rather than rebuilding filters here is what keeps the sheet's
 * contents and the row's count in agreement.
 *
 * @see {@link file://./bucket.ts} The bucket type and its filter predicate
 * @see {@link file://./../../routes/api+/asset-models.$assetModelId.assets.ts}
 * @see {@link file://./../../routes/api+/asset-models.unassigned-assets.ts}
 * @see {@link file://./../../components/assets/assets-index/asset-model-assets-sheet.tsx}
 */
import { AssetType } from "@prisma/client";
import { data } from "react-router";
import { db } from "~/database/db.server";
import { getAdvancedPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { getAssetIndexSettings } from "~/modules/asset-index-settings/service.server";
import { getClientHint } from "~/utils/client-hints";
import { redactCustodianForViewer } from "~/utils/custody-visibility.server";
import { resolveUserFormatPrefsById } from "~/utils/date-format.server";
import { makeShelfError, ShelfError } from "~/utils/error";
import { payload, error } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { applyAssetModelBucketFilters } from "./bucket";
import type { AssetModelBucket } from "./bucket";
import {
  MODEL_VIEW_INAPPLICABLE_PARAMS,
  MODEL_VIEW_SCOPED_PARAMS,
} from "./view-params";

/**
 * Serializes filter params back to this app's filter-string convention
 * (`key=operator:value`, e.g. `status=is:AVAILABLE`, see the `parseFilters`
 * docstring in `filter-parsing.ts`).
 *
 * `URLSearchParams#toString()` percent-encodes the operator colon as `%3A`.
 * `parseFilters` still decodes that back correctly (its `forEach` yields
 * decoded values), so this is not a correctness bug, but the resulting string
 * no longer looks like any other filter string in the app, which trips up
 * anything that inspects it directly. Escaping manually keeps the colon
 * literal while still escaping everything else a value can legitimately
 * contain (`&`, `=`, unicode, and so on).
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
 * Counts the assets behind one bucket with the caller's filters ignored.
 *
 * This is what lets an empty sheet say WHY it is empty: a bucket whose assets
 * are all filtered out reads identically to one that holds nothing, and only
 * this figure separates them.
 *
 * Scoped the way the rollup the sheet drills into is scoped, so the two cannot
 * describe different sets: the caller's own organization, `INDIVIDUAL` assets
 * only (a model describes distinguishable units, so a stock pool never carries
 * one), and, for a viewer restricted to bookable assets, that same narrowing.
 * A count taken over the wider set would report assets the viewer is not shown
 * anywhere else.
 *
 * @param bucket - The rollup row to count. The "No model" bucket counts assets
 *   with no model at all.
 * @param organizationId - The caller's workspace, from `requirePermission` and
 *   never from the request
 * @param availableToBookOnly - Restricts the count to assets the viewer may
 *   reserve, matching the asset query beside it
 * @returns How many assets the bucket holds, filters aside
 */
async function countBucketAssetsIgnoringFilters({
  bucket,
  organizationId,
  availableToBookOnly,
}: {
  bucket: AssetModelBucket;
  organizationId: string;
  availableToBookOnly: boolean;
}): Promise<number> {
  return db.asset.count({
    where: {
      organizationId,
      type: AssetType.INDIVIDUAL,
      assetModelId: bucket.kind === "model" ? bucket.assetModelId : null,
      ...(availableToBookOnly ? { availableToBook: true } : {}),
    },
  });
}

/**
 * Lists the assets behind one model-view row, narrowed by the filters the
 * asset index is currently showing.
 *
 * Errors are RETURNED, not thrown. A fetcher consuming a resource route
 * outside its own route tree has no in-tree boundary to catch a thrown
 * response, so it escalates to the outermost one and takes down the app shell
 * over something as ordinary as a model deleted a moment ago. Returning puts
 * the failure in `fetcher.data`, where the sheet renders it with a retry.
 * Mirrors `assets.get-assets-for-bulk-qr-download.ts`.
 *
 * @param bucket - Which rollup row to list
 * @param userId - The acting user, from the route's session
 * @param request - The incoming request, read for the forwarded `filters`
 *   param, the per-page cookie and the client's timezone hint
 * @returns A single-fetch `data()` response: the assets and their totals on
 *   success, or a `ShelfError` payload with its own status on failure.
 *   `unfilteredAssets` accompanies an empty result set and is `null` otherwise
 */
export async function loadAssetModelBucketAssets({
  bucket,
  userId,
  request,
}: {
  bucket: AssetModelBucket;
  userId: string;
  request: Request;
}) {
  try {
    const { organizationId, role, canUseBarcodes, access } =
      await requirePermission({
        userId,
        request,
        entity: PermissionEntity.asset,
        action: PermissionAction.read,
      });

    // A model id is request input, so prove it belongs to the caller's
    // organization before it reaches a query. A cross-org id 404s rather than
    // leaking whether it exists elsewhere.
    //
    // The no-model bucket has no id to prove: no `AssetModel` row stands
    // behind it. What scopes it is `organizationId` below, which comes from
    // `requirePermission` and never from the request, so a caller cannot
    // widen this past their own workspace.
    if (bucket.kind === "model") {
      const assetModel = await db.assetModel.findFirst({
        where: { id: bucket.assetModelId, organizationId },
        select: { id: true },
      });

      if (!assetModel) {
        throw new ShelfError({
          cause: null,
          message: "Asset model not found.",
          additionalData: { assetModelId: bucket.assetModelId, organizationId },
          label: "Assets",
          status: 404,
          shouldBeCaptured: false,
        });
      }
    }

    const url = new URL(request.url);
    // The caller's own search string arrives decoded, inside the `filters`
    // param. Re-parse it as a query string of its own.
    const forwarded = new URLSearchParams(
      url.searchParams.get("filters") ?? ""
    );
    MODEL_VIEW_SCOPED_PARAMS.forEach((param) => forwarded.delete(param));
    MODEL_VIEW_INAPPLICABLE_PARAMS.forEach((param) => forwarded.delete(param));
    // The bucket's own predicate, shared with the sheet's "View all in list"
    // link so the two never describe different sets. The model branch is
    // authorized by the ownership check above.
    applyAssetModelBucketFilters(forwarded, bucket);

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

    // Matches the index loader (data.server.ts) so a viewer whose list is
    // limited to bookable assets sees the same set here as on the page that
    // opened the sheet. Both endpoints are reachable directly, not only
    // through it.
    const availableToBookOnly = access.policy.assets.listScope === "bookable";

    const { assets, totalAssets, page, perPage, totalPages } =
      await getAdvancedPaginatedAndFilterableAssets({
        request,
        organizationId,
        settings,
        filters: stringifyFilters(forwarded),
        canUseBarcodes,
        timeZone,
        availableToBookOnly,
      });

    // Only an empty sheet has a use for this, and only an empty sheet pays for
    // it: a bucket with rows states its own count, and this second query on
    // every open would be a query per sheet for a sentence nobody reads.
    const unfilteredAssets =
      assets.length === 0
        ? await countBucketAssetsIgnoringFilters({
            bucket,
            organizationId,
            availableToBookOnly,
          })
        : null;

    // Empties custodian identities the viewer isn't allowed to see, same as
    // the index loader. Prisma's `select` can't vary per row, so every row
    // ships the custodian unconditionally and redaction has to happen here,
    // after the query and before the payload leaves. Without it, a restricted
    // role's "private" badge in the UI is cosmetic: the raw response already
    // carries the name and email.
    const redactedAssets = redactCustodianForViewer(assets, {
      canSeeAllCustody: access.custody.seeAll,
      userId,
    });

    return data(
      payload({
        assets: redactedAssets,
        totalAssets,
        unfilteredAssets,
        page,
        perPage,
        totalPages,
      })
    );
  } catch (cause) {
    const reason = makeShelfError(cause, {
      userId,
      ...(bucket.kind === "model"
        ? { assetModelId: bucket.assetModelId }
        : { bucket: bucket.kind }),
    });

    return data(error(reason), { status: reason.status });
  }
}
