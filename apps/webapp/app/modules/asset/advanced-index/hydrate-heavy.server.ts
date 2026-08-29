/**
 * The 3 "heavy" advanced-index hydration batches: custody, bookings,
 * barcodes. Heavy in the sense that gives this module its name: custody and
 * bookings need jsonb aggregation that typed Prisma cannot express, so they
 * are raw SQL (the only raw SQL in the streaming hydration path — everything
 * in `hydrate-simple.server.ts` is typed Prisma); barcodes stays typed Prisma
 * and is "heavy" only in that it is gated behind an entitlement flag.
 *
 * Every function here is a plain `(BatchArgs) => Promise<BatchMap<K>>`, same
 * contract as the simple batches: no read-limiter, no streaming, no abort
 * handling — the resolver that wraps these owns that.
 *
 * Raw SQL is invisible to the type-checker: a wrong column name or a dropped
 * `@map` surfaces only at request time, not at build time. Every column
 * referenced below was checked against `packages/database/prisma/schema.prisma`
 * before writing this file — none of `Custody`, `Booking`, `BookingAsset`,
 * `TeamMember`, `User`, `Kit`, or `AssetKit` declare a `@map`, so every column
 * name below is both the Prisma field name and the actual Postgres column.
 *
 * @see {@link file://./types.ts} — `BatchArgs`, `BatchMap`, and every `*Lite` shape
 * @see {@link file://./hydrate-simple.server.ts} — the 5 typed-Prisma batches;
 *   read its file header first, this module follows the same shape
 * @see {@link file://../query.server.ts} — the legacy mega-query this module
 *   replaces; `custody_agg`, `bookingsSelect`, and `barcodesSelect` are the
 *   source of truth this file's SQL and ordering are checked against
 * @see {@link file://../../../utils/custody-visibility.server.ts} — the shared
 *   redaction primitives (`viewerMaySeeCustodian`, `REDACTED_CUSTODIAN`,
 *   `redactBookingsForViewer`) this module applies
 */
import { Prisma } from "@prisma/client";
import { withPrismaRetry } from "@shelf/database";
import { db, type ExtendedPrismaClient } from "~/database/db.server";
import {
  REDACTED_CUSTODIAN,
  redactBookingsForViewer,
  viewerMaySeeCustodian,
} from "~/utils/custody-visibility.server";
import type {
  BarcodeLite,
  BatchArgs,
  BatchMap,
  BookingLite,
  CustodyLite,
} from "./types";

/** One row of the custody batch's raw query: an asset's resolved custody list,
 * already shaped as {@link CustodyLite}[] by the query's `jsonb_build_object`.
 * `custody` is `null` when the CASE resolves to neither direct nor
 * booking-derived custody (the asset holds nobody), matching the legacy
 * mega-query's `ELSE NULL`. */
type CustodyBatchRow = { assetId: string; custody: CustodyLite[] | null };

/** One row of the bookings batch's raw query: a single `BookingAsset` slice,
 * already shaped as a {@link BookingLite} by the query's `jsonb_build_object`. */
type BookingBatchRow = { assetId: string; booking: BookingLite };

/**
 * Blanks one custody entry's identifying fields when the viewer may not see
 * this custodian, leaving `quantity` (not an identity) untouched.
 *
 * The entry's top-level `name` mirrors `custodian.name` (both come from the
 * same `TeamMember` row), so both are blanked together — leaving the
 * top-level copy real would leak the identity {@link REDACTED_CUSTODIAN} on
 * `custodian` exists to hide.
 *
 * @param entry - One custody entry, as returned by the batch's query.
 * @param userId - The viewer.
 * @returns `entry` unchanged when the viewer may see it; otherwise a copy
 *   with `name` and `custodian` blanked to {@link REDACTED_CUSTODIAN}'s values.
 */
function redactCustodyEntryForViewer(
  entry: CustodyLite,
  userId: string
): CustodyLite {
  if (viewerMaySeeCustodian(entry.custodian, userId)) {
    return entry;
  }
  return {
    ...entry,
    name: REDACTED_CUSTODIAN.name,
    custodian: {
      name: REDACTED_CUSTODIAN.name,
      user: REDACTED_CUSTODIAN.user,
    },
  };
}

/**
 * Fetches the custody shown for each of `args.ids`, redacted for the viewer.
 *
 * Reproduces the legacy mega-query's custody CASE, not just its direct-custody
 * `custody_agg`: an asset's custodian is (1) its direct `Custody` rows when it
 * has any; else (2) a single BOOKING-DERIVED custodian, synthesised from the
 * asset's active (`ONGOING`/`OVERDUE`) booking, but ONLY while the asset is
 * `CHECKED_OUT` (a partially-checked-in asset must not read as still held);
 * else (3) nobody. The booking-derived branch is why a checked-out asset with
 * no `Custody` row still shows its borrower — dropping it is a silent
 * regression and a golden-CSV parity break, so it lives here even though the
 * bookings batch also surfaces that booking separately.
 *
 * Both branches emit the same {@link CustodyLite} shape, so one redaction pass
 * covers direct and derived custodians alike. The synthetic entry carries no
 * `quantity` (a booking-derived holder holds the whole asset, not a slice),
 * matching the legacy projection.
 *
 * @param args - Paged asset ids, the caller's org, and the viewer scope that
 *   drives redaction.
 * @param client - The Prisma client to query through. Defaults to the app's
 *   `db`; real-DB tests and the parity harness pass a fixture-scoped client so
 *   the raw SQL actually runs against Postgres (a module-mocked `db` never
 *   would). Production callers omit it.
 * @returns Map of assetId → that asset's custody entries, oldest direct custody
 *   first (element 0 is the primary custodian shown in the UI); a booking-derived
 *   entry is always a single-element array. An asset that holds nobody is absent
 *   from the map (the assembler applies `null`).
 */
export async function fetchCustodyBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"custody">> {
  const { ids, organizationId, viewerScope } = args;

  if (ids.length === 0) {
    return new Map();
  }

  // Prisma.join([]) throws (the SHELF-WEBAPP-1MY crash class) — the guard
  // above already rules that out, so this is always non-empty.
  const idsArray = Prisma.join(
    ids.map((id) => Prisma.sql`${id}`),
    ", "
  );

  const rows = await withPrismaRetry(
    () =>
      client.$queryRaw<CustodyBatchRow[]>(
        Prisma.sql`
          SELECT
            a.id AS "assetId",
            CASE
              -- Direct custody wins whenever the asset has any Custody row.
              WHEN jsonb_array_length(custody_agg.custody) > 0
                THEN custody_agg.custody
              -- Booking-derived fallback: a CHECKED_OUT asset in an active
              -- booking shows that booking's custodian as a single synthetic
              -- entry. 'name' resolves the booking holder's display name
              -- (registered user's displayName, else the NRM's name), matching
              -- the legacy BOOKING_CUSTODIAN_NAME fragment. No 'quantity': a
              -- booking holds the whole asset, not a slice.
              WHEN b.id IS NOT NULL AND a.status = 'CHECKED_OUT'
                THEN jsonb_build_array(
                  jsonb_build_object(
                    'name', CASE
                      WHEN bu.id IS NOT NULL
                        THEN COALESCE(NULLIF(TRIM(bu."displayName"), ''), TRIM(CONCAT(bu."firstName", ' ', bu."lastName")))
                      ELSE btm.name
                    END,
                    'custodian', jsonb_build_object(
                      'name', CASE
                        WHEN bu.id IS NOT NULL
                          THEN COALESCE(NULLIF(TRIM(bu."displayName"), ''), TRIM(CONCAT(bu."firstName", ' ', bu."lastName")))
                        ELSE btm.name
                      END,
                      'user', CASE
                        WHEN bu.id IS NOT NULL THEN
                          jsonb_build_object(
                            'id', bu.id,
                            'firstName', bu."firstName",
                            'lastName', bu."lastName",
                            'displayName', bu."displayName",
                            'profilePicture', bu."profilePicture"
                          )
                        ELSE NULL
                      END
                    )
                  )
                )
              ELSE NULL
            END AS custody
          FROM public."Asset" a
          -- Direct custody, aggregated per asset. Load-bearing ORDER BY, not
          -- cosmetic: element 0 is the primary custodian both formatCustodyList
          -- (picks custody[0]) and the custody sort key rely on. COALESCE to an
          -- empty array so the CASE's jsonb_array_length test is null-safe.
          LEFT JOIN LATERAL (
            SELECT COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'name', tm.name,
                  'quantity', cu.quantity,
                  'custodian', jsonb_build_object(
                    'name', tm.name,
                    'user', CASE
                      WHEN u.id IS NOT NULL THEN
                        jsonb_build_object(
                          'id', u.id,
                          'firstName', u."firstName",
                          'lastName', u."lastName",
                          'displayName', u."displayName",
                          'profilePicture', u."profilePicture"
                        )
                      ELSE NULL
                    END
                  )
                )
                ORDER BY cu."createdAt" ASC, cu.id ASC
              ),
              '[]'::jsonb
            ) AS custody
            FROM public."Custody" cu
            LEFT JOIN public."TeamMember" tm ON cu."teamMemberId" = tm.id
            LEFT JOIN public."User" u ON tm."userId" = u.id
            WHERE cu."assetId" = a.id
          ) custody_agg ON TRUE
          -- The asset's one active booking, if any (mirrors the legacy b
          -- LATERAL). Only ONGOING/OVERDUE count — a RESERVED booking is not
          -- yet a custody.
          LEFT JOIN LATERAL (
            SELECT bk.id, bk."custodianUserId", bk."custodianTeamMemberId"
            FROM public."Booking" bk
            JOIN public."BookingAsset" ba
              ON bk.id = ba."bookingId" AND ba."assetId" = a.id
            WHERE bk.status IN ('ONGOING', 'OVERDUE')
            LIMIT 1
          ) b ON TRUE
          LEFT JOIN public."User" bu ON b."custodianUserId" = bu.id
          LEFT JOIN public."TeamMember" btm ON b."custodianTeamMemberId" = btm.id
          -- Org boundary: a.id originates from a paged request, so it must be
          -- proven to belong to the caller's org. A foreign-org asset id
          -- matches no row here.
          WHERE a.id = ANY(ARRAY[${idsArray}]::text[])
            AND a."organizationId" = ${organizationId}
        `
      ),
    { operationIsRead: true }
  );

  const map: BatchMap<"custody"> = new Map();
  for (const row of rows) {
    // The CASE emits null for an asset that holds nobody — omit it so the
    // assembler applies the `null` default, matching every other batch's
    // absent-key convention.
    if (row.custody === null) {
      continue;
    }
    const entries = viewerScope.canSeeAllCustody
      ? row.custody
      : row.custody.map((entry) =>
          redactCustodyEntryForViewer(entry, viewerScope.userId)
        );
    map.set(row.assetId, entries);
  }
  return map;
}

/**
 * Fetches active/upcoming bookings for each of `args.ids`, one entry per
 * `BookingAsset` slice — an asset booked in two slices of the same booking
 * (a standalone row and a kit-driven row, or two kit slices) yields two
 * entries, not one.
 *
 * Mirrors the legacy mega-query's `bookingsSelect`, restructured the same way
 * as {@link fetchCustodyBatch}: one row per slice instead of one aggregate row
 * per asset, grouped into the batch map in JS.
 *
 * Ordering: the legacy `bookings` `jsonb_agg` has no `ORDER BY`, so its array
 * order is undefined. This query imposes a deterministic one — `bk."from"`
 * ascending, then `bk.id`, then `assetKitId` (kit slices before the
 * standalone slice, when both exist) — chosen so re-runs against the same
 * data always agree, which is a golden-CSV parity requirement even where the
 * legacy order was never itself meaningful; the parity check normalizes both
 * sides against this same key rather than expecting a literal array match.
 *
 * @param args - Paged asset ids, the caller's org, and the viewer scope that
 *   drives custodian redaction.
 * @param client - The Prisma client to query through; see
 *   {@link fetchCustodyBatch} for why this is injectable. Production omits it.
 * @returns Map of assetId → that asset's booking-slice entries, in the
 *   deterministic order above. An asset with no active/upcoming booking is
 *   absent from the map (the assembler applies `[]`).
 */
export async function fetchBookingsBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"bookings">> {
  const { ids, organizationId, viewerScope } = args;

  if (ids.length === 0) {
    return new Map();
  }

  const idsArray = Prisma.join(
    ids.map((id) => Prisma.sql`${id}`),
    ", "
  );

  const rows = await withPrismaRetry(
    () =>
      client.$queryRaw<BookingBatchRow[]>(
        Prisma.sql`
          SELECT
            atb."assetId" AS "assetId",
            jsonb_build_object(
              'id', bk.id,
              'name', bk.name,
              'status', bk.status,
              'from', bk."from",
              'to', bk."to",
              'description', bk.description,
              'tags', (
                SELECT COALESCE(
                  jsonb_agg(
                    jsonb_build_object('id', t.id, 'name', t.name)
                  ),
                  '[]'::jsonb
                )
                FROM public."_BookingToTag" btt
                JOIN public."Tag" t ON btt."B" = t.id
                WHERE btt."A" = bk.id
              ),
              'custodianTeamMember', CASE
                WHEN bk."custodianTeamMemberId" IS NOT NULL THEN
                  jsonb_build_object(
                    'id', ctm.id,
                    'name', ctm.name,
                    'user', CASE
                      WHEN ctm."userId" IS NOT NULL THEN
                        jsonb_build_object(
                          'id', ctmu.id,
                          'firstName', ctmu."firstName",
                          'lastName', ctmu."lastName",
                          'displayName', ctmu."displayName",
                          'profilePicture', ctmu."profilePicture"
                        )
                      ELSE NULL
                    END
                  )
                ELSE NULL
              END,
              'custodianUser', CASE
                WHEN bk."custodianUserId" IS NOT NULL THEN
                  jsonb_build_object(
                    'id', cu.id,
                    'firstName', cu."firstName",
                    'lastName', cu."lastName",
                    'displayName', cu."displayName",
                    'profilePicture', cu."profilePicture"
                  )
                ELSE NULL
              END,
              'creator', CASE
                WHEN bk."creatorId" IS NOT NULL THEN
                  jsonb_build_object(
                    'id', cr.id,
                    'firstName', cr."firstName",
                    'lastName', cr."lastName",
                    'displayName', cr."displayName",
                    'profilePicture', cr."profilePicture"
                  )
                ELSE NULL
              END,
              'assetKitId', atb."assetKitId",
              'quantity', atb."quantity",
              'kitName', bk_kit.name
            ) AS booking
          FROM public."BookingAsset" atb
          JOIN public."Booking" bk ON atb."bookingId" = bk.id
          -- Org boundary, same reasoning as fetchCustodyBatch: atb."assetId"
          -- originates from a paged request.
          JOIN public."Asset" a
            ON atb."assetId" = a.id
            AND a."organizationId" = ${organizationId}
          LEFT JOIN public."TeamMember" ctm ON bk."custodianTeamMemberId" = ctm.id
          LEFT JOIN public."User" ctmu ON ctm."userId" = ctmu.id
          LEFT JOIN public."User" cu ON bk."custodianUserId" = cu.id
          LEFT JOIN public."User" cr ON bk."creatorId" = cr.id
          -- Booking-slice kit attribution. Org-scoped (bk_ak."organizationId"
          -- = the caller's org) so a tampered or cross-org assetKitId
          -- resolves kitName to NULL instead of leaking another workspace's
          -- kit name — mirrors the legacy mega-query's identical guard.
          -- Distinct aliases (bk_ak/bk_kit) so this join never shadows a kit
          -- membership join elsewhere in the resolver.
          LEFT JOIN public."AssetKit" bk_ak
            ON atb."assetKitId" = bk_ak.id
            AND bk_ak."organizationId" = ${organizationId}
          LEFT JOIN public."Kit" bk_kit ON bk_ak."kitId" = bk_kit.id
          WHERE
            atb."assetId" = ANY(ARRAY[${idsArray}]::text[])
            AND bk.status IN ('RESERVED', 'ONGOING', 'OVERDUE')
            AND bk."organizationId" = ${organizationId}
          -- Deterministic order (the legacy aggregate has none) — see the
          -- function doc comment for why this key was chosen.
          ORDER BY bk."from" ASC, bk.id ASC, atb."assetKitId" ASC NULLS FIRST
        `
      ),
    { operationIsRead: true }
  );

  const map: BatchMap<"bookings"> = new Map();
  for (const row of rows) {
    const existing = map.get(row.assetId);
    if (existing) {
      existing.push(row.booking);
    } else {
      map.set(row.assetId, [row.booking]);
    }
  }

  // redactBookingsForViewer no-ops when the viewer can see all custody, so
  // this pass is unconditional rather than branching on that flag itself.
  for (const [assetId, bookings] of map) {
    map.set(assetId, redactBookingsForViewer(bookings, viewerScope));
  }

  return map;
}

/**
 * Fetches every barcode for each of `args.ids`, grouped by asset and ordered
 * oldest-first — typed Prisma, not raw SQL, because barcodes need no jsonb
 * aggregation; its only "heaviness" is the entitlement gate below.
 *
 * @param args - Paged asset ids, the caller's org, and the barcode
 *   entitlement flag.
 * @param client - The Prisma client to query through; see
 *   {@link fetchCustodyBatch} for why this is injectable. Production omits it.
 * @returns Map of assetId → that asset's barcodes, oldest first (matching
 *   the legacy mega-query's `barcodesSelect` ordering, which the per-type
 *   barcode columns also sort on). An asset with no barcodes is absent from
 *   the map. Empty immediately, with no query issued, when the org lacks the
 *   barcode entitlement.
 */
export async function fetchBarcodesBatch(
  args: BatchArgs,
  client: ExtendedPrismaClient = db
): Promise<BatchMap<"barcodes">> {
  const { ids, organizationId, barcodesEnabled } = args;

  if (!barcodesEnabled) {
    return new Map();
  }

  const rows = await client.barcode.findMany({
    where: { assetId: { in: ids }, organizationId },
    select: { id: true, type: true, value: true, assetId: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

  const map: BatchMap<"barcodes"> = new Map();
  for (const row of rows) {
    // `Barcode.assetId` is nullable in the schema (a barcode can belong to a
    // kit instead of an asset), so Prisma types it `string | null`. The
    // `where: { assetId: { in: ids } }` filter already excludes the null-asset
    // rows, but TypeScript can't narrow from the query, so guard explicitly
    // before using it as a map key.
    if (row.assetId === null) {
      continue;
    }
    const barcodeLite: BarcodeLite = {
      id: row.id,
      type: row.type,
      value: row.value,
    };
    const existing = map.get(row.assetId);
    if (existing) {
      existing.push(barcodeLite);
    } else {
      map.set(row.assetId, [barcodeLite]);
    }
  }
  return map;
}
