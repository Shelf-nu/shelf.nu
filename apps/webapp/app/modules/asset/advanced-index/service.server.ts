/**
 * The advanced asset index's flag-selected page service, and the adapter that
 * lets the flag-OFF (legacy) path speak the same shape as the flag-ON
 * (streaming) path.
 *
 * The client this feeds — the advanced-index loader and its cells — must
 * consume ONE shape regardless of {@link isStreamingEnabled}: a page of
 * {@link CriticalRow} plus a set of hydration sources it resolves the same
 * way either time. Flag ON gets that shape directly from
 * {@link getAdvancedAssetCriticalPage} (the row is critical-only; the rest
 * streams in later via `createDeferredHydration`, Task 14's concern). Flag
 * OFF still runs the legacy mega-query
 * (`getAdvancedPaginatedAndFilterableAssets`) UNCHANGED — every relation
 * arrives already hydrated on each row — so {@link adaptLegacyToStreamShape}
 * splits that rich row back into the same `{ items, resolved }` split the
 * streaming path produces, with `resolved` standing in for the batches that
 * never actually ran. Reassembling `items` with `resolved` via
 * `assembleHydratedAssets` (`./resolver.server`) must reproduce the legacy
 * rows field-for-field, which is exactly what this file's parity test
 * asserts — the flag-OFF path is indistinguishable to the client.
 *
 * @see {@link file://./types.ts} — `CriticalRow`, `ResolvedHydration`, every
 *   `*Lite` shape this adapter converts legacy fields into
 * @see {@link file://./critical-query.server.ts} — `getAdvancedAssetCriticalPage`,
 *   the flag-ON query this file wraps
 * @see {@link file://../service.server.ts} — `getAdvancedPaginatedAndFilterableAssets`,
 *   the flag-OFF legacy query this file wraps unchanged
 * @see {@link file://../../../utils/streaming-flag.server.ts} — `isStreamingEnabled`,
 *   the per-organization gate this file resolves once per call
 */
import type { LoaderFunctionArgs } from "react-router";
import type {
  AdvancedAssetBooking,
  AdvancedIndexAsset,
  ICustomFieldValueJson,
} from "~/modules/asset/types";
import { getAdvancedPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import { isStreamingEnabled } from "~/utils/streaming-flag.server";
import {
  getAdvancedAssetCriticalPage,
  type GetAdvancedAssetCriticalPageArgs,
} from "./critical-query.server";
import type {
  BatchMap,
  BookingLite,
  CriticalRow,
  CustodyLite,
  ResolvedHydration,
} from "./types";

/**
 * One entry of a legacy row's `custody` array — extracted from
 * {@link AdvancedIndexAsset} rather than redeclared, so this stays in sync
 * with the source type if it ever changes.
 */
type LegacyCustodyEntry = NonNullable<AdvancedIndexAsset["custody"]>[number];

/**
 * The legacy row's date-like fields — `createdAt`, `updatedAt`,
 * `mainImageExpiration`, and the nested `upcomingReminder.alertDateTime` —
 * are typed `Date` because {@link AdvancedIndexAsset} is a `Pick` off the
 * Prisma `Asset`/`AssetReminder` models. At runtime every one of them is
 * already a formatted string: the mega-query wraps each in `to_char` /
 * `utcJsonTimestamp` before it reaches JSON (see `query.server.ts`), and
 * `CriticalRow`/`ReminderLite` both declare these fields as `string` for the
 * same reason. This narrows one legacy row to its true runtime shape once, so
 * every field read below sees the corrected type instead of re-casting per
 * field.
 */
type LegacyRowRuntimeShape = Omit<
  AdvancedIndexAsset,
  "createdAt" | "updatedAt" | "mainImageExpiration" | "upcomingReminder"
> & {
  createdAt: string;
  updatedAt: string;
  mainImageExpiration: string | null;
  upcomingReminder?: {
    id: string;
    name: string;
    message: string;
    alertDateTime: string;
  };
};

/**
 * Converts one legacy custody entry to {@link CustodyLite}, dropping the
 * custodian user's `email`. This surface shows a custodian as a name and
 * picture only, never an address — rebuilding the `user` object from its
 * named fields (rather than spreading `entry.custodian.user`) keeps that true
 * regardless of what the legacy row's type happens to declare.
 *
 * @param entry - One legacy custody entry (a direct `Custody` row, or the
 *   synthetic booking-derived entry — both share this shape).
 * @returns The same entry, with `custodian.user.email` omitted.
 */
function toCustodyLite(entry: LegacyCustodyEntry): CustodyLite {
  return {
    name: entry.name,
    quantity: entry.quantity,
    custodian: {
      name: entry.custodian.name,
      user: entry.custodian.user
        ? {
            id: entry.custodian.user.id,
            firstName: entry.custodian.user.firstName,
            lastName: entry.custodian.user.lastName,
            displayName: entry.custodian.user.displayName,
            profilePicture: entry.custodian.user.profilePicture,
          }
        : null,
    },
  };
}

/**
 * Converts one legacy booking-slice entry to {@link BookingLite}.
 *
 * Unlike {@link toCustodyLite}, this passes `tags`/`custodianTeamMember`/
 * `custodianUser`/`creator` through unchanged rather than rebuilding them
 * field-by-field: the mega-query's `bookingsSelect` (`query.server.ts`) never
 * selects an `email` for any of the three user roles here, so there is nothing
 * to strip. Passing the references through (not rebuilding as object literals)
 * is simply the least error-prone way to copy shapes that carry no sensitive
 * fields.
 *
 * @param booking - One `BookingAsset` slice off a legacy row's `bookings`.
 * @returns The same slice, normalized to {@link BookingLite} (`undefined`
 *   optional fields become explicit `null`, matching the streaming batch's
 *   convention).
 */
function toBookingLite(booking: AdvancedAssetBooking): BookingLite {
  return {
    id: booking.id,
    name: booking.name,
    description: booking.description,
    status: booking.status,
    from: booking.from,
    to: booking.to,
    tags: booking.tags,
    custodianTeamMember: booking.custodianTeamMember ?? null,
    custodianUser: booking.custodianUser ?? null,
    creator: booking.creator ?? null,
    assetKitId: booking.assetKitId ?? null,
    quantity: booking.quantity ?? null,
    kitName: booking.kitName ?? null,
  };
}

/**
 * Splits the legacy mega-query's rich `AdvancedIndexAsset[]` into the same
 * `{ items, resolved }` shape the streaming path produces — this IS the
 * flag-OFF hydration. Reassembling `items` with `resolved` via
 * `assembleHydratedAssets` (`./resolver.server`) must reproduce `assets`
 * field-for-field, except: `kit` gains `status` (derived from `kits[0]`, an
 * addition, not a change), and every custodian's `email` is stripped (a
 * deliberate omission) — this file's parity test pins exactly those two
 * exceptions and no others.
 *
 * A column with no data for a row is simply left out of that column's map —
 * never stored as `[]`/`null` — matching the real streaming batches'
 * "absent means empty" convention (`assembleHydratedAssets` applies each
 * column's default). `custody` is the one column whose OWN value can
 * legitimately be `null` (nobody holds the asset); that is still represented
 * by omitting the row from the map, since the assembler's default for
 * `custody` is `null` already.
 *
 * @param assets - Rows from `getAdvancedPaginatedAndFilterableAssets`'s
 *   `assets` array, in their original (already-paged, already-sorted) order.
 * @returns `items` — one {@link CriticalRow} per input row, same order — and
 *   `resolved`, the pre-settled hydration maps a flag-OFF loader wraps in
 *   already-resolved promises instead of streaming.
 */
export function adaptLegacyToStreamShape(assets: AdvancedIndexAsset[]): {
  items: CriticalRow[];
  resolved: ResolvedHydration;
} {
  const items: CriticalRow[] = [];
  const tags: BatchMap<"tags"> = new Map();
  const locations: BatchMap<"locations"> = new Map();
  const kits: BatchMap<"kits"> = new Map();
  const customFields: BatchMap<"customFields"> = new Map();
  const reminders: BatchMap<"reminders"> = new Map();
  const custody: BatchMap<"custody"> = new Map();
  const bookings: BatchMap<"bookings"> = new Map();
  const barcodes: BatchMap<"barcodes"> = new Map();

  for (const asset of assets) {
    // See LegacyRowRuntimeShape's doc comment: the date-like fields really
    // are strings at runtime, despite the Prisma-derived `Date` typing above.
    const row = asset as unknown as LegacyRowRuntimeShape;

    items.push({
      id: row.id,
      title: row.title,
      description: row.description,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userId: row.userId,
      mainImage: row.mainImage,
      thumbnailImage: row.thumbnailImage,
      mainImageExpiration: row.mainImageExpiration,
      categoryId: row.categoryId,
      organizationId: row.organizationId,
      status: row.status,
      type: row.type,
      valuation: row.valuation,
      quantity: row.quantity,
      unitOfMeasure: row.unitOfMeasure,
      minQuantity: row.minQuantity,
      consumptionType: row.consumptionType,
      availableToBook: row.availableToBook,
      sequentialId: row.sequentialId,
      qrId: row.qrId,
      assetModelId: row.assetModelId,
      assetModelName: row.assetModelName,
      assetModel: row.assetModel,
      category: row.category,
      // `CriticalRow.kit` needs `status`, but `AdvancedIndexAsset.kit` is TYPED
      // `Pick<Kit,"id"|"name">` — a stale type; the mega-query's JSON actually
      // emits `status` on the row's own `kit` too. Derive from `kits[0]`, the
      // same primary (oldest pivot row) membership, whose type carries `status`.
      kit: row.kits[0] ?? null,
    });

    if (row.tags.length > 0) {
      tags.set(row.id, row.tags);
    }

    if (row.locations.length > 0) {
      locations.set(
        row.id,
        row.locations.map((location) => ({
          id: location.id,
          name: location.name,
          parentId: location.parentId ?? null,
          childCount: location.childCount ?? 0,
        }))
      );
    }

    if (row.kits.length > 0) {
      kits.set(row.id, row.kits);
    }

    if (row.customFields.length > 0) {
      customFields.set(
        row.id,
        row.customFields.map((customFieldValue) => ({
          id: customFieldValue.id,
          // `AssetCustomFieldValue.value` is a Prisma `Json` column — a
          // genuinely dynamic shape whose actual structure depends on
          // `customField.type`. Same narrowing every other custom-field
          // value reader in the app applies (see `hydrate-simple.server.ts`).
          value: customFieldValue.value as unknown as ICustomFieldValueJson,
          customField: {
            id: customFieldValue.customField.id,
            name: customFieldValue.customField.name,
            helpText: customFieldValue.customField.helpText,
            required: customFieldValue.customField.required,
            type: customFieldValue.customField.type,
            options: customFieldValue.customField.options,
            categories: customFieldValue.customField.categories,
          },
        }))
      );
    }

    if (row.upcomingReminder) {
      reminders.set(row.id, {
        id: row.upcomingReminder.id,
        name: row.upcomingReminder.name,
        message: row.upcomingReminder.message,
        alertDateTime: row.upcomingReminder.alertDateTime,
      });
    }

    // `null` means "nobody holds this asset" — distinct from an asset this
    // batch never looked at. Only a non-null legacy value gets a map entry;
    // omission is what signals `null` to the assembler.
    if (row.custody !== null) {
      custody.set(row.id, row.custody.map(toCustodyLite));
    }

    if (row.bookings && row.bookings.length > 0) {
      bookings.set(row.id, row.bookings.map(toBookingLite));
    }

    if (row.barcodes && row.barcodes.length > 0) {
      barcodes.set(row.id, row.barcodes);
    }
  }

  const resolved: ResolvedHydration = {
    tags,
    locations,
    kits,
    customFields,
    reminders,
    custody,
    bookings,
    barcodes,
  };

  return { items, resolved };
}

/**
 * Inputs to {@link getAdvancedIndexPage}: everything
 * `getAdvancedPaginatedAndFilterableAssets` already takes (the flag-OFF
 * path calls it unchanged), plus the resolved `whereClause`/sorting/pagination
 * inputs the flag-ON critical query needs. The caller (the advanced-index
 * loader) computes both sets once — `parsedFilters` in particular is shared
 * by both branches so the two paths can never select a different page of
 * asset ids for the same request (see `critical-query.server.ts`'s file
 * header for why that sharing matters).
 */
export type GetAdvancedIndexPageArgs = Parameters<
  typeof getAdvancedPaginatedAndFilterableAssets
>[0] &
  Omit<GetAdvancedAssetCriticalPageArgs, "organizationId" | "client">;

/**
 * What {@link getAdvancedIndexPage} returns, uniformly across both flag
 * branches. `legacyResolved` is the one field that differs by branch: present
 * (the adapter's pre-split hydration maps) only when the flag is OFF: the
 * loader (Task 14) wraps each map in an already-resolved promise instead of
 * calling `createDeferredHydration`, which is what it does when the flag is
 * ON and `legacyResolved` is `undefined`.
 */
export type AdvancedIndexPageResult = {
  items: CriticalRow[];
  search: string | null;
  totalAssets: number;
  perPage: number;
  page: number;
  totalPages: number;
  cookie: Awaited<ReturnType<typeof updateCookieWithPerPage>>;
  legacyResolved?: ResolvedHydration;
};

/**
 * Resolves the page/search/cookie inputs {@link getAdvancedIndexPage}'s
 * flag-ON branch needs for its envelope.
 *
 * Mirrors the exact parsing `getAdvancedPaginatedAndFilterableAssets` does at
 * its own top (request → search params → page/perPageParam/search, then the
 * per-page cookie, then the query's `[1, 100]` page-size clamp) so both flag
 * branches agree on these values for the same request. The flag-OFF branch
 * never calls this: it reads the same values back from the legacy call's own
 * return instead of recomputing them.
 *
 * @param request - The incoming request (cookie header, and the fallback
 *   source of search params when `filters` is empty).
 * @param filters - A pre-serialized filter/search string, when the caller
 *   already has one (skips re-reading the request's own search params).
 * @returns The resolved page, search term, per-page cookie, and `take` — the
 *   page size clamped to the query's bound (the legacy service's `perPage`).
 */
async function resolveIndexPageParams(
  request: LoaderFunctionArgs["request"],
  filters: string
) {
  const currentFilterParams = new URLSearchParams(filters || "");
  const searchParams = filters
    ? currentFilterParams
    : getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);
  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const take = Math.min(Math.max(cookie.perPage, 1), 100);
  return { page, search, cookie, take };
}

/**
 * The advanced asset index's flag-selected page service.
 *
 * Resolves {@link isStreamingEnabled} once, then either:
 * - **Flag ON** — calls {@link getAdvancedAssetCriticalPage} for the page's
 *   critical rows and filtered total count. `legacyResolved` is `undefined`;
 *   the loader (Task 14) builds `deferred` hydration sources from the
 *   returned ids itself.
 * - **Flag OFF** — calls the existing `getAdvancedPaginatedAndFilterableAssets`
 *   UNCHANGED, then splits its rich rows via {@link adaptLegacyToStreamShape}.
 *   `legacyResolved` carries the pre-split hydration maps the loader wraps in
 *   already-resolved promises.
 *
 * Both branches return the FULL envelope
 * (`search, totalAssets, perPage, page, totalPages, cookie`) — never just
 * `{ items }` — so the loader can keep building the rest of the page payload
 * without branching on the flag itself.
 *
 * @param args - See {@link GetAdvancedIndexPageArgs}.
 * @returns See {@link AdvancedIndexPageResult}.
 */
export async function getAdvancedIndexPage(
  args: GetAdvancedIndexPageArgs
): Promise<AdvancedIndexPageResult> {
  const {
    request,
    organizationId,
    settings,
    filters = "",
    takeAll = false,
    assetIds,
    getBookings = false,
    canUseBarcodes = false,
    availableToBookOnly = false,
    timeZone = "UTC",
    parsedFilters,
    whereClause,
    orderByInner,
    customFieldSortings,
    sortBy,
    paginationClause,
  } = args;

  if (isStreamingEnabled(organizationId)) {
    const { page, search, cookie, take } = await resolveIndexPageParams(
      request,
      filters
    );
    const { total_count, items } = await getAdvancedAssetCriticalPage({
      organizationId,
      whereClause,
      orderByInner,
      customFieldSortings,
      sortBy,
      parsedFilters,
      paginationClause,
    });

    return {
      items,
      search,
      totalAssets: total_count,
      perPage: take,
      page,
      totalPages: Math.ceil(total_count / take),
      cookie,
    };
  }

  const legacyResult = await getAdvancedPaginatedAndFilterableAssets({
    request,
    organizationId,
    settings,
    filters,
    takeAll,
    assetIds,
    getBookings,
    canUseBarcodes,
    availableToBookOnly,
    preParsedFilters: parsedFilters,
    timeZone,
  });

  const { items, resolved } = adaptLegacyToStreamShape(legacyResult.assets);

  return {
    items,
    search: legacyResult.search,
    totalAssets: legacyResult.totalAssets,
    perPage: legacyResult.perPage,
    page: legacyResult.page,
    totalPages: legacyResult.totalPages,
    cookie: legacyResult.cookie,
    legacyResolved: resolved,
  };
}
