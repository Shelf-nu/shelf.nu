import type {
  Asset,
  AssetIndexSettings,
  Barcode,
  Booking,
  Kit,
  Organization,
  Prisma,
  Qr,
  TeamMember,
  User,
  UserOrganization,
} from "@prisma/client";
import {
  AssetStatus,
  AssetType,
  BookingStatus,
  ErrorCorrection,
  KitStatus,
  NoteType,
} from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { extractStoragePath } from "~/components/assets/asset-image/utils";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import {
  updateBarcodes,
  validateBarcodeUniqueness,
} from "~/modules/barcode/service.server";
import { normalizeBarcodeValue } from "~/modules/barcode/validation";
import { assetQtyMeta, formatUnitCount } from "~/utils/asset-quantity";
import { ASSET_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import type { ErrorLabel } from "~/utils/error";
import {
  isLikeShelfError,
  isNotFoundError,
  maybeUniqueConstraintViolation,
  ShelfError,
  VALIDATION_ERROR,
} from "~/utils/error";
import { extractImageNameFromSupabaseUrl } from "~/utils/extract-image-name-from-supabase-url";
import { getRedirectUrlFromRequest } from "~/utils/http";
import { getCurrentSearchParams } from "~/utils/http.server";
import { id } from "~/utils/id/id.server";
import { ALL_SELECTED_KEY, getParamsValues } from "~/utils/list";
import { Logger } from "~/utils/logger";
import {
  wrapCustodianForNote,
  wrapKitsWithDataForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import { oneDayFromNow, threeDaysFromNow } from "~/utils/one-week-from-now";
import {
  assertAssetsBelongToOrg,
  assertCategoryBelongsToOrg,
  assertLocationBelongsToOrg,
  assertTeamMemberBelongsToOrg,
} from "~/utils/org-validation.server";
import { createSignedUrl, parseFileFormData } from "~/utils/storage.server";
import type { MergeInclude } from "~/utils/utils";
import type { UpdateKitPayload } from "./types";
import {
  GET_KIT_STATIC_INCLUDES,
  KIT_SELECT_FIELDS_FOR_LIST_ITEMS,
  KITS_INCLUDE_FIELDS,
} from "./types";
import { getKitsWhereInput } from "./utils.server";
import { recordEvent, recordEvents } from "../activity-event/service.server";
import { resolveAssetIdsForBulkOperation } from "../asset/bulk-operations-helper.server";
import type {
  MoveAssetKitUnitsArgs,
  MoveUnitsResult,
} from "../asset/move-units.types";
import type { CreateAssetFromContentImportPayload } from "../asset/types";
import { getPrimaryLocation } from "../asset/utils";
import {
  getAssetsWhereInput,
  getKitLocationUpdateNoteContent,
} from "../asset/utils.server";
import { createSystemBookingNote } from "../booking-note/service.server";
import { lockAssetForQuantityUpdate } from "../consumption-log/quantity-lock.server";
import { getPrimaryCustody, hasCustody } from "../custody/utils";
import { createSystemLocationNote } from "../location-note/service.server";
import {
  createBulkKitChangeNotes,
  createKitMoveNote,
  createNote,
} from "../note/service.server";
import { getQr } from "../qr/service.server";
import { getUserByID } from "../user/service.server";

const label: ErrorLabel = "Kit";

/**
 * Build per-asset Custody rows that inherit a KitCustody assignment.
 *
 * When a kit is in custody, every asset in the kit gets a child Custody row
 * tagged with `kitCustodyId` so the row's origin is traceable. The rule for
 * `quantity`:
 * - INDIVIDUAL assets always inherit `quantity: 1`.
 * - QUANTITY_TRACKED assets inherit only the **remaining** pool — the asset's
 *   total `quantity` minus any already-allocated Custody rows (operator
 *   custody and pre-existing kit-allocated custody are both subtracted; the
 *   helper does not distinguish — what matters is "how many units are not
 *   already spoken for"). When remaining <= 0 the asset is silently skipped
 *   (no child row created), so the kit-custody flow degrades gracefully when
 *   an asset is fully allocated to operators.
 *
 * Tagging the child rows with `kitCustodyId` is what allows us to delete only
 * kit-allocated custody (filter by `kitCustodyId`) without disturbing
 * operator-assigned per-unit custody on the same asset, and lets the FK
 * cascade clean them up automatically when the parent KitCustody is deleted.
 *
 * @param args.tx - Transactional Prisma client (so the existing-custody read
 *   sees rows written earlier in the same tx).
 * @param args.kitCustodyId - The parent KitCustody row this inheritance points back to.
 * @param args.teamMemberId - The custodian team member, copied to every child row.
 * @param args.assetIds - Assets in the kit that should receive inherited custody.
 * @returns A flat array suitable for `tx.custody.createMany({ data })`. Empty
 *   when every asset is fully operator-allocated.
 */
/**
 * Structural type for the only Prisma surface we need from the tx. Typed this
 * way (rather than `Prisma.TransactionClient`) because the project uses an
 * extended Prisma client, and the extended tx is not directly assignable to
 * the generated `Prisma.TransactionClient`. Mirrors the `RecordEventTxClient`
 * pattern used in `activity-event/service.server.ts`.
 */
type KitCustodyInheritTxClient = {
  asset: {
    findMany: (args: {
      where: { id: { in: string[] } };
      select: {
        id: true;
        type: true;
        quantity: true;
        custody: { select: { quantity: true } };
        assetKits: {
          where: { kitId: string };
          select: { quantity: true };
        };
      };
    }) => Promise<
      Array<{
        id: string;
        type: AssetType;
        quantity: number | null;
        custody: Array<{ quantity: number }>;
        assetKits: Array<{ quantity: number }>;
      }>
    >;
  };
};

/**
 * Pre-fetches the kit-driven `BookingAsset` rows that will
 * be converted to standalone (via the DB-level `SET NULL` cascade) when
 * the given `AssetKit` rows are deleted. Call this BEFORE the
 * `tx.assetKit.deleteMany(...)` inside the same transaction; pair the
 * returned array with {@link emitAssetKitDetachmentNotes} after the
 * delete completes to log a per-booking system note.
 *
 * Scope filter: only DRAFT / RESERVED / ONGOING / OVERDUE bookings get
 * notes — already-completed / cancelled / archived bookings are
 * historical and don't need notification of the cascade.
 *
 * @param tx Prisma transaction client (extended `any` per project pattern)
 * @param assetKitIds AssetKit rows about to be deleted in the same tx
 * @returns Array of `{ bookingAssetId, bookingId, bookingName, assetTitle, kitName }`
 *   capturing the affected pre-delete state so the post-delete note can
 *   reference the kit by name (which would otherwise be unrecoverable).
 */
export async function fetchAssetKitDetachmentImpact(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  assetKitIds: string[]
): Promise<
  Array<{
    bookingAssetId: string;
    bookingId: string;
    bookingName: string;
    assetId: string;
    assetTitle: string;
    kitId: string;
    kitName: string;
  }>
> {
  if (assetKitIds.length === 0) return [];
  // `BookingAsset.assetKitId` is a plain FK column with no back-relation
  // (see schema.prisma:1603 — relation deliberately omitted), so we
  // can't `select: { assetKit: {...} }` here. Two queries + in-memory
  // join instead.
  const [rows, assetKitRows] = await Promise.all([
    tx.bookingAsset.findMany({
      where: {
        assetKitId: { in: assetKitIds },
        booking: {
          status: { in: ["DRAFT", "RESERVED", "ONGOING", "OVERDUE"] },
        },
      },
      select: {
        id: true,
        bookingId: true,
        assetKitId: true,
        booking: { select: { name: true } },
        asset: { select: { id: true, title: true } },
      },
    }),
    tx.assetKit.findMany({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetKitIds` derive from the org-scoped kit/assetKits fetch in this flow
      where: { id: { in: assetKitIds } },
      select: { id: true, kitId: true, kit: { select: { name: true } } },
    }),
  ]);
  const akById = new Map<
    string,
    { id: string; kitId: string; kit: { name: string } }
  >(
    assetKitRows.map(
      (ak: { id: string; kitId: string; kit: { name: string } }) => [ak.id, ak]
    )
  );
  return rows.map(
    (r: {
      id: string;
      bookingId: string;
      assetKitId: string;
      booking: { name: string };
      asset: { id: string; title: string };
    }) => {
      const ak = akById.get(r.assetKitId);
      return {
        bookingAssetId: r.id,
        bookingId: r.bookingId,
        bookingName: r.booking.name,
        assetId: r.asset.id,
        assetTitle: r.asset.title,
        kitId: ak?.kitId ?? "",
        kitName: ak?.kit?.name ?? "",
      };
    }
  );
}

/**
 * Companion to {@link fetchAssetKitDetachmentImpact}. Writes a system
 * note on each affected booking explaining that the kit's booked slice
 * has been converted to a standalone reservation. The kit-driven
 * BookingAsset row itself stays in the booking — the DB-level
 * `ON DELETE SET NULL` cascade just clears its `assetKitId` so the
 * booking UI groups it as standalone going forward.
 *
 * No activity-event emission yet — that would require a new enum value
 * (e.g. `BOOKING_ASSET_DETACHED_FROM_KIT`) and a migration. Deferred;
 * the system notes alone cover the user-visible audit trail.
 */
/**
 * Resolves the standalone-vs-kit-driven `BookingAsset` collision that
 * arises when an `AssetKit` row is about to be deleted (kit removal,
 * cross-kit move). The DB-level `ON DELETE SET NULL` cascade would clear
 * `assetKitId` on the matching `BookingAsset` rows — but if a standalone
 * row (`assetKitId IS NULL`) already exists for the same
 * `(bookingId, assetId)` pair, the SET NULL violates
 * `BookingAsset_manual_unique` and the whole tx rolls back with P2002.
 *
 * For each colliding pair this helper merges the kit-driven qty into the
 * standalone row and deletes the kit-driven row, so the subsequent
 * `tx.assetKit.deleteMany(...)` has no row to cascade onto for that pair.
 * Non-colliding kit-driven rows are left untouched — the cascade converts
 * them to standalone as before.
 *
 * Call BEFORE `tx.assetKit.deleteMany(...)`. The companion
 * {@link fetchAssetKitDetachmentImpact} must run BEFORE this helper too,
 * since it needs the kit-driven rows to still exist to capture their
 * booking + asset names.
 *
 * INDIVIDUAL assets can't collide (the trigger
 * `enforce_individual_asset_single_kit` already prevents an INDIVIDUAL
 * asset from being in multiple slices), but for safety the merge handles
 * them the same way QUANTITY_TRACKED ones are handled.
 */
export async function mergeStandaloneCollisionsForKitDetachment(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  assetKitIds: string[]
): Promise<void> {
  if (assetKitIds.length === 0) return;
  const kitDrivenRows: Array<{
    id: string;
    bookingId: string;
    assetId: string;
    quantity: number;
  }> = await tx.bookingAsset.findMany({
    where: { assetKitId: { in: assetKitIds } },
    select: { id: true, bookingId: true, assetId: true, quantity: true },
  });
  if (kitDrivenRows.length === 0) return;

  const standaloneMatches: Array<{
    id: string;
    bookingId: string;
    assetId: string;
    quantity: number;
  }> = await tx.bookingAsset.findMany({
    where: {
      assetKitId: null,
      OR: kitDrivenRows.map((r) => ({
        bookingId: r.bookingId,
        assetId: r.assetId,
      })),
    },
    select: { id: true, bookingId: true, assetId: true, quantity: true },
  });
  if (standaloneMatches.length === 0) return;

  const standaloneByPair = new Map<string, (typeof standaloneMatches)[number]>(
    standaloneMatches.map((s) => [`${s.bookingId}::${s.assetId}`, s])
  );

  for (const kdr of kitDrivenRows) {
    const standalone = standaloneByPair.get(`${kdr.bookingId}::${kdr.assetId}`);
    if (!standalone) continue;
    await tx.bookingAsset.update({
      where: { id: standalone.id },
      data: { quantity: standalone.quantity + kdr.quantity },
    });
    await tx.bookingAsset.delete({ where: { id: kdr.id } });
  }
}

export async function emitAssetKitDetachmentNotes({
  impact,
  actorUserId,
  actorFirstName,
  actorLastName,
  organizationId,
}: {
  impact: Awaited<ReturnType<typeof fetchAssetKitDetachmentImpact>>;
  actorUserId: string;
  actorFirstName: string | null;
  actorLastName: string | null;
  organizationId: string;
}) {
  if (impact.length === 0) return;
  const actorLink = wrapUserLinkForNote({
    id: actorUserId,
    firstName: actorFirstName,
    lastName: actorLastName,
  });
  // One note per (booking, kit) pair. Multiple assets removed from the
  // same kit in the same delete are collapsed to a single note per
  // booking so we don't spam the booking activity feed.
  type Group = {
    bookingId: string;
    kitName: string;
    assetTitles: string[];
  };
  const groups = new Map<string, Group>();
  for (const row of impact) {
    const key = `${row.bookingId}::${row.kitId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.assetTitles.push(row.assetTitle);
    } else {
      groups.set(key, {
        bookingId: row.bookingId,
        kitName: row.kitName,
        assetTitles: [row.assetTitle],
      });
    }
  }
  for (const group of groups.values()) {
    const subjects =
      group.assetTitles.length === 1
        ? `**${group.assetTitles[0]}**`
        : `**${group.assetTitles.length} assets** (${group.assetTitles
            .map((t) => `*${t}*`)
            .join(", ")})`;
    // `createSystemBookingNote` doesn't accept a tx (matches the other
    // booking-note call sites). The note creates outside the kit-delete
    // tx; in the unlikely event the tx rolls back, the note is
    // orphaned. Acceptable per the existing pattern in
    // `apps/webapp/app/modules/booking/service.server.ts`.
    await createSystemBookingNote({
      bookingId: group.bookingId,
      organizationId,
      content: `${actorLink} removed ${subjects} from kit **${group.kitName}**. The kit's booked slice has been converted to a standalone reservation in this booking.`,
    });
  }
}

export async function buildKitCustodyInheritData({
  tx,
  kitId,
  kitCustodyId,
  teamMemberId,
  assetIds,
}: {
  tx: KitCustodyInheritTxClient;
  /** The Kit whose custody is being assigned. Used to find each asset's
   * per-kit AssetKit.quantity. */
  kitId: string;
  kitCustodyId: string;
  teamMemberId: string;
  assetIds: string[];
}): Promise<Prisma.CustodyCreateManyInput[]> {
  if (assetIds.length === 0) return [];

  const assets = await tx.asset.findMany({
    // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetIds` are resolved org-scoped by the caller (updateKitAssets fetches them via the org-scoped `where: { id: { in }, organizationId }` asset query) before this helper runs
    where: { id: { in: assetIds } },
    select: {
      id: true,
      type: true,
      quantity: true,
      // Pre-existing Custody rows (operator-allocated + any kit-allocated
      // from previously-assigned kits) — needed for the strict cap below.
      custody: { select: { quantity: true } },
      // The kit's allocated slice is the primary source of truth;
      // defensive `?.[0]` handles the case where the row is missing
      // (shouldn't happen — caller passes assetIds that belong to this
      // kit — but we'd rather skip than crash).
      assetKits: {
        where: { kitId },
        select: { quantity: true },
      },
    },
  });

  const rows: Prisma.CustodyCreateManyInput[] = [];
  for (const asset of assets) {
    if (asset.type !== AssetType.QUANTITY_TRACKED) {
      rows.push({
        teamMemberId,
        assetId: asset.id,
        kitCustodyId,
        quantity: 1,
      });
      continue;
    }

    // Read the kit's allocated slice from `AssetKit`, then cap by
    // `Asset.quantity − sum(pre-existing Custody)` so kit-inherited
    // custody never overlaps operator-assigned custody on the same
    // asset. Once the picker is the only way to mutate
    // `AssetKit.quantity`, the cap is a no-op (`AssetKit.quantity` will
    // already be ≤ that ceiling), but it stays correct when
    // `AssetKit.quantity` is the asset's full pool from the backfill
    // while operator custody exists separately.
    //
    // Defensive `?.` on `assetKits` itself — older test fixtures don't
    // include the relation in their mock asset shape; the production
    // code path always pulls it via the select above.
    const kitSlice = asset.assetKits?.[0]?.quantity ?? 0;
    if (kitSlice <= 0) continue;

    const preExistingCustody = asset.custody.reduce(
      (sum, row) => sum + (row.quantity ?? 0),
      0
    );
    const availableCeiling = (asset.quantity ?? 0) - preExistingCustody;
    const quantity = Math.max(0, Math.min(kitSlice, availableCeiling));
    if (quantity <= 0) continue;

    rows.push({
      teamMemberId,
      assetId: asset.id,
      kitCustodyId,
      quantity,
    });
  }
  return rows;
}

export async function createKit({
  name,
  description,
  createdById,
  organizationId,
  qrId,
  categoryId,
  locationId,
  barcodes,
}: Pick<
  Kit,
  | "name"
  | "description"
  | "createdById"
  | "organizationId"
  | "categoryId"
  | "locationId"
> & {
  qrId?: Qr["id"];
  barcodes?: Pick<Barcode, "type" | "value">[];
}) {
  try {
    /** User connection data */
    const user = {
      connect: {
        id: createdById,
      },
    };

    const organization = {
      connect: {
        id: organizationId as string,
      },
    };

    /**
     * If a qr code is passed, link to that QR
     * Otherwise, create a new one
     * Here we also need to double check:
     * 1. If the qr code exists
     * 2. If the qr code belongs to the current organization
     * 3. If the qr code is not linked to an asset
     */
    const qr = qrId ? await getQr({ id: qrId }) : null;
    const qrCodes =
      qr &&
      qr.organizationId === organizationId &&
      qr.assetId === null &&
      qr.kitId === null
        ? { connect: { id: qrId } }
        : {
            create: [
              {
                id: id(),
                version: 0,
                errorCorrection: ErrorCorrection["L"],
                user,
                organization,
              },
            ],
          };

    // why: categoryId comes from form input — prove it belongs to this
    // kit's org before connecting, else an attacker links a foreign
    // tenant's category (cross-org IDOR)
    if (categoryId) {
      await assertCategoryBelongsToOrg({ categoryId, organizationId });
    }

    const data: Prisma.KitCreateInput = {
      name,
      description,
      createdBy: user,
      organization,
      qrCodes,
      category: categoryId ? { connect: { id: categoryId } } : undefined,
    };

    /** If barcodes are passed, create them */
    if (barcodes && barcodes.length > 0) {
      const barcodesToAdd = barcodes.filter(
        (barcode) => !!barcode.value && !!barcode.type
      );

      Object.assign(data, {
        barcodes: {
          create: barcodesToAdd.map(({ type, value }) => ({
            type,
            // Normalize per type (ExternalQR keeps its case, others uppercase)
            // so stored kit barcodes match what filters/lookups expect — same
            // rule the asset create path uses via `normalizeBarcodeValue`.
            value: normalizeBarcodeValue(type, value),
            organizationId,
          })),
        },
      });
    }

    if (locationId) {
      // why: locationId comes from form input — prove it belongs to this
      // kit's org before connecting (cross-org IDOR guard)
      await assertLocationBelongsToOrg({ locationId, organizationId });
      data.location = { connect: { id: locationId } };
    }

    // Use transaction to ensure kit creation and activity event are atomic
    const kit = await db.$transaction(async (tx) => {
      const created = await tx.kit.create({ data });

      // Activity event must be inside transaction for atomicity
      await recordEvent(
        {
          organizationId,
          actorUserId: createdById,
          action: "KIT_CREATED",
          entityType: "KIT",
          entityId: created.id,
          kitId: created.id,
        },
        tx
      );

      return created;
    });

    return kit;
  } catch (cause) {
    // If it's a Prisma unique constraint violation on barcode values,
    // use our detailed validation to provide specific field errors
    if (cause instanceof Error && "code" in cause && cause.code === "P2002") {
      const prismaError = cause as any;
      const target = prismaError.meta?.target;

      if (
        target &&
        target.includes("value") &&
        barcodes &&
        barcodes.length > 0
      ) {
        const barcodesToAdd = barcodes.filter(
          (barcode) => !!barcode.value && !!barcode.type
        );
        if (barcodesToAdd.length > 0) {
          // Use existing validation function for detailed error messages
          await validateBarcodeUniqueness(barcodesToAdd, organizationId);
        }
      }
    }

    throw maybeUniqueConstraintViolation(cause, "Kit", {
      additionalData: { userId: createdById, organizationId },
    });
  }
}

export async function updateKit({
  id,
  name,
  description,
  image,
  imageExpiration,
  status,
  createdById,
  organizationId,
  categoryId,
  barcodes,
  locationId,
}: UpdateKitPayload) {
  try {
    const data: Prisma.KitUpdateInput = {
      name,
      description,
      image,
      imageExpiration,
      status,
    };

    /** If uncategorized is passed, disconnect the category */
    if (categoryId === "uncategorized") {
      Object.assign(data, {
        category: {
          disconnect: true,
        },
      });
    }

    // If category id is passed and is different than uncategorized, connect the category
    if (categoryId && categoryId !== "uncategorized") {
      // why: categoryId comes from form input — prove it belongs to this
      // kit's org before connecting (cross-org IDOR guard)
      await assertCategoryBelongsToOrg({ categoryId, organizationId });
      Object.assign(data, {
        category: {
          connect: {
            id: categoryId,
          },
        },
      });
    }

    if (locationId) {
      // why: locationId comes from form input — prove it belongs to this
      // kit's org before connecting (cross-org IDOR guard)
      await assertLocationBelongsToOrg({ locationId, organizationId });
      data.location = { connect: { id: locationId } };
    }

    const kit = await db.kit.update({
      where: { id, organizationId },
      data,
    });

    /** If barcodes are passed, update existing barcodes efficiently */
    if (barcodes !== undefined) {
      await updateBarcodes({
        barcodes,
        kitId: id,
        organizationId,
        userId: createdById,
      });
    }

    await recordEvent({
      organizationId,
      actorUserId: createdById,
      action: "KIT_UPDATED",
      entityType: "KIT",
      entityId: kit.id,
      kitId: kit.id,
    });

    return kit;
  } catch (cause) {
    // If it's already a ShelfError with validation errors, re-throw as is
    if (
      cause instanceof ShelfError &&
      cause.additionalData?.[VALIDATION_ERROR]
    ) {
      throw cause;
    }

    throw maybeUniqueConstraintViolation(cause, "Kit", {
      additionalData: { userId: createdById, id },
    });
  }
}

export async function updateKitImage({
  request,
  kitId,
  userId,
  organizationId,
}: {
  request: Request;
  kitId: string;
  userId: string;
  organizationId: Kit["organizationId"];
}) {
  try {
    const fileData = await parseFileFormData({
      request,
      bucketName: "kits",
      newFileName: `${userId}/${kitId}/image-${dateTimeInUnix(Date.now())}`,
      resizeOptions: {
        width: 800,
        withoutEnlargement: true,
      },
      maxFileSize: ASSET_MAX_IMAGE_UPLOAD_SIZE,
    });

    const image = fileData.get("image") as string;
    if (!image) return;

    const signedUrl = await createSignedUrl({
      filename: image,
      bucketName: "kits",
    });

    await updateKit({
      id: kitId,
      image: signedUrl,
      imageExpiration: oneDayFromNow(),
      createdById: userId,
      organizationId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating image for kit.",
      additionalData: { kitId, userId, field: "image" },
      label,
    });
  }
}

/**
 * Re-signs expired Supabase signed image URLs for a set of kits, in place.
 *
 * Kit thumbnails are served via short-lived Supabase signed URLs. When a URL
 * has expired, the `KitImage` component would otherwise fire a client-side
 * refresh fetcher on mount — and on a multi-row report table that means one
 * fetcher per expired row (a refresh storm). This mirrors
 * `refreshExpiredAssetImages`: we re-sign server-side in the loader so rows
 * carry fresh URLs and the client fetcher stays dormant.
 *
 * Kits are simpler than assets — a single `image` field, no separate
 * thumbnail. Failures are logged and skipped (the row keeps its stale URL and
 * the client `KitImage` fallback still covers genuinely broken images), so a
 * storage hiccup never fails the report.
 *
 * @param kits - Kits carrying `id`, `organizationId`, `image`, `imageExpiration`
 * @returns The same array with fresh `image`/`imageExpiration` for any that were expired
 */
export async function refreshExpiredKitImages<
  T extends {
    id: string;
    organizationId: string;
    image: string | null;
    imageExpiration: Date | null;
  },
>(kits: T[]): Promise<T[]> {
  const now = new Date();
  const expiredKits = kits.filter(
    (k) => k.image && k.imageExpiration && new Date(k.imageExpiration) < now
  );

  if (expiredKits.length === 0) return kits;

  /** Batch size keeps Supabase signed-URL calls bounded. */
  const BATCH_SIZE = 10;

  const refreshKit = async (kit: (typeof expiredKits)[number]) => {
    try {
      const imagePath = extractStoragePath(kit.image!, "kits");
      if (!imagePath) return null;

      const newImageUrl = await createSignedUrl({
        filename: imagePath,
        bucketName: "kits",
      });

      // 72h expiration reduces how often the loader has to re-sign.
      const newExpiration = threeDaysFromNow();

      await db.kit.update({
        where: { id: kit.id, organizationId: kit.organizationId },
        data: { image: newImageUrl, imageExpiration: newExpiration },
      });

      return { id: kit.id, image: newImageUrl, imageExpiration: newExpiration };
    } catch {
      // Kit deleted, or file removed from storage between query and update —
      // expected, not a bug. Log and skip; the row keeps its stale URL.
      Logger.info(
        `Failed to refresh image for kit ${kit.id}, proceeding with stale URL`
      );
      return null;
    }
  };

  const refreshed = new Map<string, { image: string; imageExpiration: Date }>();
  for (let i = 0; i < expiredKits.length; i += BATCH_SIZE) {
    const batch = expiredKits.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(refreshKit));
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        refreshed.set(result.value.id, {
          image: result.value.image,
          imageExpiration: result.value.imageExpiration,
        });
      }
    }
  }

  return kits.map((k) => {
    const fresh = refreshed.get(k.id);
    return fresh ? { ...k, ...fresh } : k;
  });
}

export async function getPaginatedAndFilterableKits<
  T extends Prisma.KitInclude,
>({
  request,
  organizationId,
  extraInclude,
  currentBookingId,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  extraInclude?: T;
  currentBookingId?: Booking["id"];
}) {
  // include. Treat either `assets` (legacy callers passing typed shapes
  // that may still reference the old relation) or `assetKits` as the
  // signal that the caller wants the asset list available for the
  // hide-empty filter below.
  function hasAssetsIncluded(
    extraInclude?: Prisma.KitInclude
  ): extraInclude is Prisma.KitInclude & { assetKits: boolean } {
    return !!extraInclude?.assetKits;
  }

  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);

  const status =
    searchParams.get("status") === "ALL"
      ? null
      : (searchParams.get("status") as KitStatus | null);
  const teamMember = searchParams.get("teamMember"); // custodian

  const {
    page,
    perPageParam,
    search,
    hideUnavailable,
    bookingFrom,
    bookingTo,
  } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    const where: Prisma.KitWhereInput = { organizationId };

    if (search) {
      const searchTerm = search.toLowerCase().trim();
      where.OR = [
        // Search in kit name
        { name: { contains: searchTerm, mode: "insensitive" } },
        // Search in barcode values
        {
          barcodes: {
            some: { value: { contains: searchTerm, mode: "insensitive" } },
          },
        },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (teamMember) {
      Object.assign(where, {
        custody: { custodianId: teamMember },
      });
    }

    if (currentBookingId && hideUnavailable) {
      // "every asset in this kit matches X" predicate becomes
      // "every AssetKit row's asset matches X".
      //
      // QUANTITY_TRACKED assets carry Custody rows for partial operator
      // allocations on a single pooled asset (e.g. Pleb holds 4 of 80
      // Pens). Those rows do *not* make the kit unavailable for
      // booking — the booking system's own availability formula
      // handles the math at checkout time. Only INDIVIDUAL custody
      // means the physical item is unavailable. Mirrors the
      // `getKitAvailabilityStatus` exemption + the kit picker fixes.
      where.assetKits = {
        every: {
          asset: {
            organizationId,
            OR: [
              { type: AssetType.QUANTITY_TRACKED },
              { custody: { none: {} } },
            ],
          },
        },
      };

      if (bookingFrom && bookingTo) {
        // Apply booking conflict logic similar to assets, but through kit assets
        const kitWhere: Prisma.KitWhereInput[] = [
          // Rule 1: RESERVED bookings always exclude kits (if any asset is in a RESERVED booking)
          {
            assetKits: {
              none: {
                asset: {
                  bookingAssets: {
                    some: {
                      booking: {
                        id: { not: currentBookingId },
                        status: BookingStatus.RESERVED,
                        OR: [
                          {
                            from: { lte: bookingTo },
                            to: { gte: bookingFrom },
                          },
                          {
                            from: { gte: bookingFrom },
                            to: { lte: bookingTo },
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          // Rule 2: For ONGOING/OVERDUE bookings, allow kits that are AVAILABLE or have no conflicting assets
          {
            OR: [
              // Either kit is AVAILABLE (checked in from partial check-in)
              { status: KitStatus.AVAILABLE },
              // Or kit has no assets in conflicting ONGOING/OVERDUE bookings
              {
                assetKits: {
                  none: {
                    asset: {
                      bookingAssets: {
                        some: {
                          booking: {
                            id: { not: currentBookingId },
                            status: {
                              in: [
                                BookingStatus.ONGOING,
                                BookingStatus.OVERDUE,
                              ],
                            },
                            OR: [
                              {
                                from: { lte: bookingTo },
                                to: { gte: bookingFrom },
                              },
                              {
                                from: { gte: bookingFrom },
                                to: { lte: bookingTo },
                              },
                            ],
                          },
                        },
                      },
                    },
                  },
                },
              },
            ],
          },
        ];

        // Combine the basic filters with booking conflict filters
        where.AND = kitWhere;
      }
    }

    if (
      currentBookingId &&
      hideUnavailable === true &&
      (!bookingFrom || !bookingTo)
    ) {
      throw new ShelfError({
        cause: null,
        message: "Booking dates are needed to hide unavailable kit.",
        additionalData: { hideUnavailable, bookingFrom, bookingTo },
        label,
      });
    }

    const include = {
      ...extraInclude,
      ...KITS_INCLUDE_FIELDS,
    } as MergeInclude<typeof KITS_INCLUDE_FIELDS, T>;

    let [kits, totalKits, totalKitsWithoutAssets] = await Promise.all([
      db.kit.findMany({
        skip,
        take,
        where,
        include,
        orderBy: { createdAt: "desc" },
      }),
      db.kit.count({ where }),
      // rows.
      db.kit.count({
        where: { organizationId, assetKits: { none: {} } },
      }),
    ]);

    if (hideUnavailable && hasAssetsIncluded(extraInclude)) {
      kits = kits.filter((kit) => {
        // extraInclude is dynamic, so the kit shape is widened here.
        // Cast to a minimal pivot shape rather than disabling type
        // checks file-wide.
        const ak = (kit as { assetKits?: unknown[] }).assetKits;
        return Array.isArray(ak) && ak.length > 0;
      });
    }

    const totalPages = Math.ceil(totalKits / perPage);

    return {
      page,
      perPage,
      kits,
      totalKits: hideUnavailable
        ? totalKits - totalKitsWithoutAssets
        : totalKits,
      totalPages,
      search,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching kits",
      additionalData: { page, perPage, organizationId },
      label,
    });
  }
}

type KitWithInclude<T extends Prisma.KitInclude | undefined> =
  T extends Prisma.KitInclude
    ? Prisma.KitGetPayload<{
        include: MergeInclude<typeof GET_KIT_STATIC_INCLUDES, T>;
      }>
    : Prisma.KitGetPayload<{ include: typeof GET_KIT_STATIC_INCLUDES }>;

// why: `const T` (TS 5.0+) preserves the literal type of the inline
// `extraInclude` passed at the call site. Without it, T widens to
// `Prisma.KitInclude` and consumers lose the deep shape (e.g.
// `kit.assetKits[0].asset.status`), forcing `as unknown as {…}` casts.
export async function getKit<const T extends Prisma.KitInclude | undefined>({
  id,
  organizationId,
  extraInclude,
  userOrganizations,
  request,
}: Pick<Kit, "id" | "organizationId"> & {
  extraInclude?: T;
  userOrganizations?: Pick<UserOrganization, "organizationId">[];
  request?: Request;
}) {
  try {
    const otherOrganizationIds = userOrganizations?.map(
      (org) => org.organizationId
    );

    // Merge static includes with dynamic includes
    const includes = {
      ...GET_KIT_STATIC_INCLUDES,
      ...extraInclude,
    } as MergeInclude<typeof GET_KIT_STATIC_INCLUDES, T>;

    const kit = await db.kit.findFirstOrThrow({
      where: {
        OR: [
          { id, organizationId },
          ...(userOrganizations?.length
            ? [{ id, organizationId: { in: otherOrganizationIds } }]
            : []),
        ],
      },
      include: includes,
    });

    /* User is accessing the asset in the wrong organizations. In that case we need special 404 handlng. */
    if (
      userOrganizations?.length &&
      kit.organizationId !== organizationId &&
      otherOrganizationIds?.includes(kit.organizationId)
    ) {
      const redirectTo =
        typeof request !== "undefined"
          ? getRedirectUrlFromRequest(request)
          : undefined;

      throw new ShelfError({
        cause: null,
        title: "Kit not found",
        message: "",
        additionalData: {
          model: "kit",
          organization: userOrganizations.find(
            (org) => org.organizationId === kit.organizationId
          ),
          redirectTo,
        },
        label,
        status: 404,
        shouldBeCaptured: false, // In this case we shouldnt be capturing the error
      });
    }

    return kit as KitWithInclude<T>;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      title: "Kit not found",
      message:
        "The kit you are trying to access does not exist or you do not have permission to access it.",
      additionalData: {
        id,
        ...(isShelfError ? cause.additionalData : {}),
      },
      label,
      shouldBeCaptured: isShelfError
        ? cause.shouldBeCaptured
        : !isNotFoundError(cause),
    });
  }
}

export async function getAssetsForKits({
  request,
  organizationId,
  extraWhere,
  kitId,
  ignoreFilters,
}: {
  request: LoaderFunctionArgs["request"];
  organizationId: Organization["id"];
  kitId: Kit["id"];
  extraWhere?: Prisma.AssetWhereInput;
  /** Set this to true if you don't want the search filters to be applied */
  ignoreFilters?: boolean;
}) {
  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);
  const { page, perPageParam, search, orderBy, orderDirection } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20; // min 1 and max 100 per page

    // `AssetKit` pivot. Filter through the pivot instead.
    const where: Prisma.AssetWhereInput = {
      organizationId,
      assetKits: { some: { kitId } },
    };

    if (search && !ignoreFilters) {
      const searchTerm = search.toLowerCase().trim();
      where.OR = [
        // Search in asset title
        { title: { contains: searchTerm, mode: "insensitive" } },
        // Search in asset barcodes
        {
          barcodes: {
            some: { value: { contains: searchTerm, mode: "insensitive" } },
          },
        },
      ];
    }

    const finalQuery = {
      ...where,
      ...extraWhere,
    };

    const [items, totalItems] = await Promise.all([
      db.asset.findMany({
        skip,
        take,
        where: finalQuery,
        select: KIT_SELECT_FIELDS_FOR_LIST_ITEMS,
        // Stable `id` tiebreaker for deterministic skip/take paging when rows
        // tie on the sort key (see the matching comment in
        // asset/service.server.ts). Skipped when already sorting by id.
        orderBy: [
          { [orderBy]: orderDirection },
          ...(orderBy !== "id" ? [{ id: "asc" as const }] : []),
        ],
      }),
      db.asset.count({ where: finalQuery }),
    ]);

    const totalPages = Math.ceil(totalItems / perPage);

    return { page, perPage, search, items, totalItems, totalPages };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Fail to fetch paginated and filterable assets",
      additionalData: {
        organizationId,
        paramsValues,
      },
      label,
    });
  }
}

/**
 * Pre-fetched kit shape consumed by `performKitDeletion`. Kept loose
 * (just the fields the helper actually reads) so both single + bulk
 * call sites can share the same pipeline.
 */
type KitForDeletion = {
  id: Kit["id"];
  name: Kit["name"];
  image: Kit["image"];
  // `type` + `unitOfMeasure` let us render the per-row unit count for
  // QUANTITY_TRACKED assets in the release note ("custody of 50 units");
  // the actual custody quantity is read from the inherited Custody rows
  // below. `kitQuantity` is this kit's per-row AssetKit.quantity (NOT
  // Asset.quantity) — surfaced in the cascade ASSET_KIT_CHANGED event meta.
  assets: Array<{
    id: string;
    title: string;
    type: AssetType;
    unitOfMeasure: string | null;
    kitQuantity: number;
  }>;
  custody: {
    id: string;
    custodian: {
      id: string;
      name: string;
      user: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        displayName: string | null;
      } | null;
    };
  } | null;
};

/**
 * Shared deletion pipeline for `deleteKit` + `bulkDeleteKits`.
 *
 * Whether you're deleting one kit or many, the steps are identical:
 *   1. Pre-read inherited Custody rows (so we can emit
 *      `CUSTODY_RELEASED` events before the FK cascade wipes them).
 *   2. Inside a transaction:
 *      a. Emit one `CUSTODY_RELEASED` event per inherited row, tagged
 *         with the source kit + custodian for audit.
 *      b. Delete the kits — FK cascades clean up
 *         `Kit → KitCustody → Custody` and `Asset.kitId` is set null.
 *      c. Conditional status flip: only assets with **zero** remaining
 *         Custody rows after the cascade drop to `AVAILABLE`. Assets
 *         with surviving operator custody (Phase 2 multi-custodian)
 *         keep `IN_CUSTODY` so we don't lie about state.
 *   3. Outside the tx (best-effort, audit-only):
 *      a. Write asset notes — one `createNotes` call per in-custody
 *        kit so each group gets its kit's correct custodian.
 *      b. Delete kit images.
 *
 * @param args.kits - Pre-fetched kits with the shape above. Caller is
 *   responsible for org-scoping the read.
 * @param args.organizationId - Used for status-flip scoping + event meta.
 * @param args.userId - Actor for events + note attribution.
 */
async function performKitDeletion({
  kits,
  organizationId,
  userId,
}: {
  kits: KitForDeletion[];
  organizationId: Kit["organizationId"];
  userId: string;
}) {
  if (kits.length === 0) return;

  const kitIdsToDelete = kits.map((k) => k.id);
  const inCustodyKits = kits.filter((k) => !!k.custody);
  const allAssetIds = kits.flatMap((k) => k.assets.map((a) => a.id));

  // Resolve the actor once for note text — only needed when at least
  // one kit was in custody (an AVAILABLE kit emits nothing).
  let actorLink = "";
  if (inCustodyKits.length > 0) {
    const actor = await getUserByID(userId, {
      select: {
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    actorLink = wrapUserLinkForNote({
      id: userId,
      firstName: actor?.firstName,
      lastName: actor?.lastName,
    });
  }

  // Per-asset units released by the kit-delete, sourced from the inherited
  // Custody rows read inside the tx. Populated below; consumed by the
  // release notes written after the tx (which only have `k.assets`, not the
  // Custody rows, in scope). Empty for INDIVIDUAL-only deletes.
  const releasedQtyByAssetId = new Map<string, number | null>();

  await db.$transaction(async (tx) => {
    const kitCustodyIds = inCustodyKits
      .map((k) => k.custody?.id)
      .filter((id): id is string => Boolean(id));

    if (kitCustodyIds.length > 0) {
      const inheritedCustodyRows = await tx.custody.findMany({
        where: { kitCustodyId: { in: kitCustodyIds } },
        select: {
          assetId: true,
          teamMemberId: true,
          kitCustodyId: true,
          // The units this kit moved into custody — drives the
          // qty-tracked unit count in both the CUSTODY_RELEASED event
          // meta and the release note below.
          quantity: true,
        },
      });

      if (inheritedCustodyRows.length > 0) {
        // Map each row's source kit so events carry the correct
        // `kitId` + `targetUserId`.
        const kitByKitCustodyId = new Map(
          inCustodyKits.map((k) => [k.custody!.id, k])
        );

        // Asset shape (type / unitOfMeasure) for the qty-tracked unit count.
        // The Custody rows only carry `assetId`, so look the asset up here.
        const assetById = new Map(
          kits.flatMap((k) => k.assets).map((a) => [a.id, a])
        );

        // Record the released quantity per asset so the post-tx note can
        // name "custody of 50 units" without re-reading the Custody rows.
        for (const row of inheritedCustodyRows) {
          releasedQtyByAssetId.set(row.assetId, row.quantity);
        }

        await recordEvents(
          inheritedCustodyRows.map((row) => {
            const sourceKit = kitByKitCustodyId.get(row.kitCustodyId!);
            const asset = assetById.get(row.assetId);
            return {
              organizationId,
              actorUserId: userId,
              action: "CUSTODY_RELEASED" as const,
              entityType: "ASSET" as const,
              entityId: row.assetId,
              assetId: row.assetId,
              kitId: sourceKit?.id,
              teamMemberId: row.teamMemberId,
              targetUserId:
                sourceKit?.custody?.custodian?.user?.id ?? undefined,
              meta: {
                viaKit: true,
                viaKitDelete: true,
                ...(asset ? assetQtyMeta(asset, row.quantity) : {}),
              },
            };
          }),
          tx
        );
      }
    }

    // Activity events — one ASSET_KIT_CHANGED per asset that loses its
    // kit on cascade. Emitted before the deleteMany so the AssetKit
    // pivot rows are still readable for context if a future report
    // needs them. Folded in from main's PR #2535 which emitted these
    // inline in both `deleteKit` and `bulkDeleteKits`; the shared
    // helper deduplicates that.
    const kitByAssetId = new Map<string, KitForDeletion>();
    // Asset shape (type) + the per-row AssetKit.quantity this asset held in
    // the kit being deleted — both keyed by id for the cascade event meta.
    const assetForEventById = new Map<
      string,
      KitForDeletion["assets"][number]
    >();
    for (const k of kits) {
      for (const a of k.assets) {
        kitByAssetId.set(a.id, k);
        assetForEventById.set(a.id, a);
      }
    }
    if (allAssetIds.length > 0) {
      await recordEvents(
        allAssetIds.map((assetId) => {
          const sourceKit = kitByAssetId.get(assetId);
          const asset = assetForEventById.get(assetId);
          return {
            organizationId,
            actorUserId: userId,
            action: "ASSET_KIT_CHANGED" as const,
            entityType: "ASSET" as const,
            entityId: assetId,
            assetId,
            kitId: sourceKit?.id,
            field: "kitId",
            fromValue: sourceKit?.id ?? null,
            toValue: null,
            // Qty-tracked: the per-row AssetKit.quantity held in the deleted
            // kit (NOT Asset.quantity); {} for INDIVIDUAL / unknown asset.
            meta: asset ? { ...assetQtyMeta(asset, asset.kitQuantity) } : {},
          };
        }),
        tx
      );
    }

    await tx.kit.deleteMany({
      where: { id: { in: kitIdsToDelete }, organizationId },
    });

    if (allAssetIds.length > 0) {
      const assetsWithRemainingCustody = await tx.custody.findMany({
        where: { assetId: { in: allAssetIds } },
        select: { assetId: true },
      });
      const stillCustodiedAssetIds = new Set(
        assetsWithRemainingCustody.map((c) => c.assetId)
      );
      const assetsToFlipAvailable = allAssetIds.filter(
        (assetId) => !stillCustodiedAssetIds.has(assetId)
      );
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetsToFlipAvailable }, organizationId },
          data: { status: AssetStatus.AVAILABLE },
        });
      }
    }
  });

  if (inCustodyKits.length > 0) {
    // One note per asset (not one shared string per kit): qty-tracked assets
    // each name their own released unit count ("custody of 50 units"), so the
    // content differs per row. INDIVIDUAL assets keep the exact prior wording.
    // why: org-scoping is implicit — `inCustodyKits`/`k.assets` are derived
    // from the org-scoped kit reads at the call sites, never request input.
    const noteData = inCustodyKits
      .filter((k) => k.assets.length > 0)
      .flatMap((k) => {
        const custodianDisplay = k.custody?.custodian
          ? wrapCustodianForNote({ teamMember: k.custody.custodian })
          : "**Unknown Custodian**";
        return k.assets.map((asset) => {
          const count = formatUnitCount(
            asset,
            releasedQtyByAssetId.get(asset.id)
          );
          const custodyPhrase = count ? `custody of ${count}` : "custody";
          return {
            content: `${actorLink} released ${custodianDisplay}'s ${custodyPhrase} when kit **${k.name.trim()}** was deleted.`,
            type: "UPDATE" as const,
            userId,
            assetId: asset.id,
          };
        });
      });
    if (noteData.length > 0) {
      await db.note.createMany({ data: noteData });
    }
  }

  const kitWithImages = kits.filter((k) => !!k.image);
  await Promise.all(
    kitWithImages.map((k) => deleteKitImage({ url: k.image! }))
  );
}

export async function deleteKit({
  id,
  organizationId,
  actorUserId,
}: {
  id: Kit["id"];
  organizationId: Kit["organizationId"];
  /**
   * Actor for the activity events + system notes emitted when a
   * **kit-in-custody** is deleted, and for the per-asset
   * `ASSET_KIT_CHANGED` events fired for every asset that loses its
   * kit on cascade. Renamed from `userId` to align with the rest of
   * the activity-event call sites (see PR #2535).
   */
  actorUserId: string;
}) {
  try {
    const kitRow = await db.kit.findUniqueOrThrow({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        image: true,
        assetKits: {
          // type + unitOfMeasure feed the qty-tracked unit count in the
          // kit-deletion release note (see performKitDeletion); quantity is
          // this kit's per-row AssetKit.quantity for the cascade event meta.
          select: {
            quantity: true,
            asset: {
              select: {
                id: true,
                title: true,
                type: true,
                unitOfMeasure: true,
              },
            },
          },
        },
        custody: {
          select: {
            id: true,
            custodian: {
              select: {
                id: true,
                name: true,
                // why: wrapCustodianForNote / wrapUserLinkForNote use the
                // first/last/displayName to render the linked-text in the
                // resulting note; without them the fallback reads
                // "Unknown User".
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Flatten pivot rows into the in-memory `assets` shape that
    // `performKitDeletion` consumes. `kitQuantity` carries the per-row
    // AssetKit.quantity (NOT Asset.quantity) for the cascade event meta.
    const kit = {
      ...kitRow,
      assets: (kitRow.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kitQuantity: ak.quantity,
      })),
    };

    await performKitDeletion({
      kits: [kit],
      organizationId,
      userId: actorUserId,
    });

    return kit;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting kit",
      additionalData: { id, organizationId, userId: actorUserId },
      label,
    });
  }
}

export async function deleteKitImage({
  url,
  bucketName = "kits",
}: {
  url: string;
  bucketName?: string;
}) {
  try {
    const path = extractImageNameFromSupabaseUrl({ url, bucketName });
    if (!path) {
      throw new ShelfError({
        cause: null,
        message: "Cannot extract the image path from the URL",
        additionalData: { url, bucketName },
        label,
      });
    }

    const { error } = await getSupabaseAdmin()
      .storage.from(bucketName)
      .remove([path]);

    if (error) {
      throw error;
    }

    return true;
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Failed to delete kit image",
        additionalData: { url, bucketName },
        label,
      })
    );
  }
}

export async function releaseCustody({
  kitId,
  userId,
  organizationId,
}: {
  kitId: Kit["id"];
  userId: string;
  organizationId: Kit["organizationId"];
}) {
  try {
    const [kitRow, actor] = await Promise.all([
      db.kit.findUniqueOrThrow({
        where: { id: kitId, organizationId },
        select: {
          id: true,
          name: true,
          assetKits: {
            // type + unitOfMeasure power the qty-tracked unit count in the
            // release note ("custody of 50 units"); the count itself comes
            // from the inherited Custody rows captured inside the tx.
            select: {
              asset: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  unitOfMeasure: true,
                },
              },
            },
          },
          createdBy: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
          custody: {
            select: {
              id: true,
              custodian: { include: { user: true } },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    // Flatten pivot rows so downstream code reads the same shape it
    // did pre-pivot. Optional chaining tolerates fixtures / payloads
    // that omit the pivot relation entirely.
    const kit = {
      ...kitRow,
      assets: (kitRow.assetKits ?? []).map((ak) => ak.asset),
    };

    const actorLink = wrapUserLinkForNote({
      id: userId,
      firstName: actor?.firstName,
      lastName: actor?.lastName,
    });
    const custodianDisplay = kit.custody?.custodian
      ? wrapCustodianForNote({ teamMember: kit.custody.custodian })
      : "**Unknown Custodian**";
    const kitLink = wrapLinkForNote(`/kits/${kit.id}`, kit.name.trim());

    // Per-asset units released, populated inside the tx from the inherited
    // Custody rows; consumed by the post-tx note (which has only `kit.assets`,
    // not the Custody rows, in scope). Empty for INDIVIDUAL-only kits.
    const releasedQtyByAssetId = new Map<string, number | null>();

    // Use transaction for atomicity - prevents orphaned custody records on partial failure
    // Activity events must be inside to ensure audit trail consistency
    await db.$transaction(async (tx) => {
      // Capture the kit-allocated Custody rows BEFORE the cascade so we can
      // emit `CUSTODY_RELEASED` events for them. Filtering by `kitCustodyId`
      // means operator-assigned custody on the same assets is left untouched
      // when the FK cascade fires.
      const kitCustodyId = kit.custody?.id;
      const inheritedCustodyRows = kitCustodyId
        ? await tx.custody.findMany({
            where: { kitCustodyId },
            select: {
              assetId: true,
              teamMemberId: true,
              kitCustodyId: true,
              // Units this kit released — drives the qty-tracked count in the
              // CUSTODY_RELEASED event meta + the release note below.
              quantity: true,
            },
          })
        : [];

      // Asset shape (type / unitOfMeasure) keyed by id, for the unit count.
      const assetById = new Map(kit.assets.map((a) => [a.id, a]));

      // Activity events emitted FIRST — recordEvents runs inside the tx so
      // they roll back atomically if the kit-update below fails.
      if (inheritedCustodyRows.length > 0) {
        // Record released units per asset so the post-tx note can name them.
        for (const row of inheritedCustodyRows) {
          releasedQtyByAssetId.set(row.assetId, row.quantity);
        }
        await recordEvents(
          inheritedCustodyRows.map((row) => {
            const asset = assetById.get(row.assetId);
            return {
              organizationId,
              actorUserId: userId,
              action: "CUSTODY_RELEASED" as const,
              entityType: "ASSET" as const,
              entityId: row.assetId,
              assetId: row.assetId,
              kitId: kit.id,
              teamMemberId: row.teamMemberId,
              targetUserId: kit.custody?.custodian?.user?.id ?? undefined,
              meta: {
                viaKit: true,
                ...(asset ? assetQtyMeta(asset, row.quantity) : {}),
              },
            };
          }),
          tx
        );
      }

      // Delete kit custody and update kit status. Deleting the KitCustody
      // row cascades to its child Custody rows (kitCustodyId FK) — no
      // explicit `tx.custody.deleteMany` is needed any more.
      await tx.kit.update({
        where: { id: kitId, organizationId },
        data: {
          status: KitStatus.AVAILABLE,
          custody: { delete: true },
        },
      });

      // Only mark assets AVAILABLE if no operator-assigned custody remains.
      // If an asset still has direct (non-kit) custody, it keeps IN_CUSTODY.
      const assetIds = kit.assets.map((a) => a.id);
      const assetsWithRemainingCustody = await tx.custody.findMany({
        where: { assetId: { in: assetIds } },
        select: { assetId: true },
      });
      const stillCustodiedAssetIds = new Set(
        assetsWithRemainingCustody.map((c) => c.assetId)
      );
      const assetsToFlipAvailable = assetIds.filter(
        (id) => !stillCustodiedAssetIds.has(id)
      );
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          where: { id: { in: assetsToFlipAvailable }, organizationId },
          data: { status: AssetStatus.AVAILABLE },
        });
      }
    });

    // Notes can be created outside transaction (not critical for consistency).
    // One note per asset (not a shared string): qty-tracked assets each name
    // their own released unit count ("custody of 50 units"); INDIVIDUAL assets
    // keep the exact prior wording.
    // why: notes target this kit's org-scoped assets — same-tenant by
    // construction (kit was loaded with `organizationId` above).
    const releaseNoteData = kit.assets.map((asset) => {
      const count = formatUnitCount(asset, releasedQtyByAssetId.get(asset.id));
      const custodyPhrase = count ? `custody of ${count}` : "custody";
      return {
        content: `${actorLink} released ${custodianDisplay}'s ${custodyPhrase} via kit: ${kitLink}.`,
        type: "UPDATE" as const,
        userId,
        assetId: asset.id,
      };
    });
    if (releaseNoteData.length > 0) {
      await db.note.createMany({ data: releaseNoteData });
    }

    return kit;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while releasing the custody. Please try again or contact support.",
      additionalData: { kitId },
      label: "Custody",
    });
  }
}

export async function updateKitsWithBookingCustodians<T extends Kit>(
  kits: T[]
): Promise<T[]> {
  try {
    /** When kits are checked out, we have to display the custodian from that booking */
    const checkedOutKits = kits
      .filter((kit) => kit.status === "CHECKED_OUT")
      .map((k) => k.id);

    if (checkedOutKits.length === 0) {
      return kits;
    }

    const resolvedKits: T[] = [];

    for (const kit of kits) {
      if (!checkedOutKits.includes(kit.id)) {
        resolvedKits.push(kit);
        continue;
      }

      /** A kit is not directly associated with booking so have to make an extra query to get the booking for kit.
       * We filter for assets that have an active booking to avoid picking
       * an asset in the kit that is AVAILABLE and has no relevant booking.
       * Kit membership is read through the `AssetKit` pivot. */
      const kitAsset = await db.asset.findFirst({
        where: {
          assetKits: { some: { kitId: kit.id } },
          bookingAssets: {
            some: { booking: { status: { in: ["ONGOING", "OVERDUE"] } } },
          },
        },
        select: {
          id: true,
          bookingAssets: {
            where: { booking: { status: { in: ["ONGOING", "OVERDUE"] } } },
            include: {
              booking: {
                select: {
                  id: true,
                  custodianTeamMember: true,
                  custodianUser: {
                    select: {
                      firstName: true,
                      lastName: true,
                      displayName: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      const booking = kitAsset?.bookingAssets[0]?.booking;
      const custodianUser = booking?.custodianUser;
      const custodianTeamMember = booking?.custodianTeamMember;

      if (custodianUser) {
        resolvedKits.push({
          ...kit,
          custody: {
            custodian: {
              name: `${custodianUser?.firstName || ""} ${
                custodianUser?.lastName || ""
              }`, // Concatenate firstName and lastName to form the name property with default values
              user: {
                firstName: custodianUser?.firstName || "",
                lastName: custodianUser?.lastName || "",
                profilePicture: custodianUser?.profilePicture || null,
              },
            },
          },
        });
      } else if (custodianTeamMember) {
        resolvedKits.push({
          ...kit,
          custody: {
            custodian: { name: custodianTeamMember.name },
          },
        });
      } else {
        resolvedKits.push(kit);
        /** This case should never happen because there must be a custodianUser or custodianTeamMember assigned to a booking */
        Logger.error(
          new ShelfError({
            cause: null,
            message: "Could not find custodian for kit",
            additionalData: { kit },
            label,
          })
        );
      }
    }

    return resolvedKits;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to update kits with booking custodian",
      additionalData: { kits },
      label,
    });
  }
}

type CurrentBookingType = {
  id: string;
  name: string;
  custodianUser: Pick<
    User,
    "firstName" | "lastName" | "profilePicture" | "email"
  > | null;
  custodianTeamMember: TeamMember | null;
  status: BookingStatus;
  from: Booking["from"];
};

/**
 * Determines if a kit has a current booking by checking its assets.
 * A kit is considered to have a current booking when at least one of its assets is:
 * 1. Currently checked out (status === CHECKED_OUT)
 * 2. Has an ongoing or overdue booking
 *
 * This ensures the custody card only shows when assets are actually in custody,
 * not just when they have ongoing bookings but have been checked back in.
 *
 * @returns The first ongoing/overdue booking found, or undefined if none exist
 */
export function getKitCurrentBooking(kit: {
  id: string;
  assets: {
    status: AssetStatus;
    bookingAssets: { booking: CurrentBookingType }[];
  }[];
}) {
  const ongoingBookingAsset = kit.assets
    // Filter each asset's bookingAssets to only ongoing or overdue ones
    .map((a) => ({
      ...a,
      bookingAssets: a.bookingAssets.filter(
        (ba) =>
          ba.booking.status === BookingStatus.ONGOING ||
          ba.booking.status === BookingStatus.OVERDUE
      ),
    }))
    // Only consider assets that are actually checked out
    .filter((a) => a.status === AssetStatus.CHECKED_OUT)
    // Find the first asset that has any ongoing/overdue bookings
    .find((a) => a.bookingAssets.length > 0);

  const ongoingBooking = ongoingBookingAsset
    ? ongoingBookingAsset.bookingAssets[0].booking
    : undefined;

  return ongoingBooking;
}

export async function bulkDeleteKits({
  kitIds,
  organizationId,
  userId,
  currentSearchParams,
}: {
  kitIds: Kit["id"][];
  organizationId: Kit["organizationId"];
  userId: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all kits in the list then we have to consider filters too
     */
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    const kitRows = await db.kit.findMany({
      where,
      select: {
        id: true,
        name: true,
        image: true,
        assetKits: {
          // type + unitOfMeasure feed the qty-tracked unit count in the
          // kit-deletion release note (see performKitDeletion); quantity is
          // this kit's per-row AssetKit.quantity for the cascade event meta.
          select: {
            quantity: true,
            asset: {
              select: {
                id: true,
                title: true,
                type: true,
                unitOfMeasure: true,
              },
            },
          },
        },
        custody: {
          select: {
            id: true,
            custodian: {
              select: {
                id: true,
                name: true,
                // why: wrapCustodianForNote / wrapUserLinkForNote use the
                // first/last/displayName to render the linked-text in the
                // resulting note; without them the fallback reads
                // "Unknown User".
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Flatten pivot rows into the in-memory `assets` shape that
    // `performKitDeletion` consumes. Main's PR #2535 added per-asset
    // ASSET_KIT_CHANGED emission for the cascade unkit inside
    // `bulkDeleteKits` — on our branch the equivalent emission lives in
    // `performKitDeletion` so single + bulk paths share one
    // implementation (see the recordEvents call there). `kitQuantity`
    // carries the per-row AssetKit.quantity (NOT Asset.quantity) for the
    // cascade event meta.
    const kits = kitRows.map((k) => ({
      ...k,
      assets: (k.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kitQuantity: ak.quantity,
      })),
    }));

    await performKitDeletion({
      kits,
      organizationId,
      userId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while bulk deleting kits.",
      additionalData: { kitIds, organizationId, userId },
      label,
    });
  }
}

export async function bulkAssignKitCustody({
  kitIds,
  organizationId,
  custodianId,
  custodianName,
  userId,
  currentSearchParams,
}: {
  kitIds: Kit["id"][];
  organizationId: Kit["organizationId"];
  custodianId: TeamMember["id"];
  custodianName: TeamMember["name"];
  userId: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /**
     * If we are selecting all assets in list then we have to consider filters
     */
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /**
     * We have to make notes and assign custody to all assets of a kit so we have to make this query.
     * `type` and `quantity` are needed so qty-tracked assets get the asset's
     * full tracked quantity on the inherited Custody row (Site 3 of the kit
     * custody correctness fixes).
     */
    const [kits, user, custodianTeamMember] = await Promise.all([
      db.kit.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          // We include the kit's id/name on each asset row by
          // re-projecting the parent kit, since the helper needs a
          // {kit: {id, name}} shape downstream to render the note link.
          assetKits: {
            select: {
              asset: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  type: true,
                  quantity: true,
                  unitOfMeasure: true,
                },
              },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
      db.teamMember.findFirst({
        where: { id: custodianId, organizationId },
        select: {
          id: true,
          name: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              displayName: true,
            },
          },
        },
      }),
    ]);

    const someKitsNotAvailable = kits.some((kit) => kit.status !== "AVAILABLE");
    if (someKitsNotAvailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable kits. Please make sure you are selecting only available kits.",
        label,
      });
    }

    // Flatten the pivot rows into {asset, kit} pairs so downstream code
    // (notes, activity events) can read both sides without changing
    // shape.
    const allAssetsOfAllKits = kits.flatMap((kit) =>
      (kit.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kit: { id: kit.id, name: kit.name },
      }))
    );

    // INDIVIDUAL assets block the assign; QUANTITY_TRACKED don't.
    // `buildKitCustodyInheritData` writes the *remaining* pool per asset,
    // so a qty-tracked asset whose row-level status is IN_CUSTODY (some
    // units operator-held) still assigns the leftover quantity, and
    // fully-allocated assets are silently skipped — neither needs to
    // block here.
    const someAssetsUnavailable = allAssetsOfAllKits.some(
      (asset) =>
        asset.type !== "QUANTITY_TRACKED" && asset.status !== "AVAILABLE"
    );
    if (someAssetsUnavailable) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some unavailable assets in some kits. Please make sure you have all available assets in kits.",
        label,
      });
    }

    /**
     * updateMany does not allow to create nested relationship rows so we have
     * to make two queries to assign custody over
     * 1. Create custodies for kit
     * 2. Update status of all kits to IN_CUSTODY
     */
    return await db.$transaction(async (tx) => {
      // SECURITY (cross-org IDOR): custodianId comes from request input. The
      // org-scoped lookup above is only used for the note text — the writes
      // below connect the raw id, so prove it belongs to this org first or an
      // attacker could assign a foreign-org team member as kit/asset custodian.
      await assertTeamMemberBelongsToOrg(
        { teamMemberId: custodianId, organizationId },
        tx
      );

      /** Creating custodies over kits */
      await tx.kitCustody.createMany({
        data: kits.map((kit) => ({
          custodianId,
          kitId: kit.id,
        })),
      });

      /** Updating status of all kits */
      await tx.kit.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `kits` ids come from the org-scoped findMany above (where includes organizationId via getKitsWhereInput / line 1189)
        where: { id: { in: kits.map((kit) => kit.id) } },
        data: { status: KitStatus.IN_CUSTODY },
      });

      /**
       * `createMany` doesn't return rows, so re-query the just-created
       * KitCustody rows to get their IDs. Each child Custody row is tagged
       * with its parent's `kitCustodyId` so the kit→assets relationship is
       * traceable and FK cascade can clean up on release.
       */
      const kitCustodyRows = await tx.kitCustody.findMany({
        where: { kitId: { in: kits.map((kit) => kit.id) } },
        select: { id: true, kitId: true },
      });
      const kitCustodyByKitId = new Map(
        kitCustodyRows.map((kc) => [kc.kitId, kc.id])
      );

      /** If a kit is going to be in custody, then all it's assets should also inherit the same status */

      /** Creating custodies over assets of kits — one row per (asset, kit-custody) */
      const inheritDataPerKit = await Promise.all(
        kits.map(async (kit) => {
          const kitCustodyId = kitCustodyByKitId.get(kit.id);
          if (!kitCustodyId) return [];
          return buildKitCustodyInheritData({
            tx,
            kitId: kit.id,
            kitCustodyId,
            teamMemberId: custodianId,
            assetIds: (kit.assetKits ?? []).map((ak) => ak.asset.id),
          });
        })
      );
      const inheritData = inheritDataPerKit.flat();
      if (inheritData.length > 0) {
        await tx.custody.createMany({ data: inheritData });
      }

      // Per-(kit-custody, asset) inherited quantity — the units this kit
      // actually moved into custody (kit slice capped by free pool), NOT the
      // asset's total. Drives the qty-tracked unit count in the note + event.
      const inheritedQtyByKey = new Map(
        inheritData.map((row) => [
          `${row.kitCustodyId}:${row.assetId}`,
          row.quantity ?? 0,
        ])
      );
      const inheritedQtyFor = (asset: { id: string; kit?: { id: string } }) => {
        const kitCustodyId = asset.kit
          ? kitCustodyByKitId.get(asset.kit.id)
          : undefined;
        return kitCustodyId
          ? inheritedQtyByKey.get(`${kitCustodyId}:${asset.id}`)
          : undefined;
      };

      /** Updating status of all assets of kits */
      await tx.asset.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: assets are derived from `kits` (kit.assets) loaded by the org-scoped findMany above; not from request input
        where: { id: { in: allAssetsOfAllKits.map((asset) => asset.id) } },
        data: { status: AssetStatus.IN_CUSTODY },
      });

      /** Creating notes for all the assets of the kit */
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      const custodianDisplay = custodianTeamMember
        ? wrapCustodianForNote({ teamMember: custodianTeamMember })
        : `**${custodianName.trim()}**`;
      await tx.note.createMany({
        data: allAssetsOfAllKits.map((asset) => {
          const kitLink = asset.kit
            ? wrapLinkForNote(`/kits/${asset.kit.id}`, asset.kit.name.trim())
            : "**Unknown Kit**";
          // For qty-tracked assets, name the unit count actually moved into
          // custody ("custody of 50 units"); INDIVIDUAL phrasing is unchanged.
          const count = formatUnitCount(asset, inheritedQtyFor(asset));
          const custodyPhrase = count ? `custody of ${count}` : "custody";
          return {
            content: `${actor} granted ${custodianDisplay} ${custodyPhrase} via kit assignment ${kitLink}.`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          };
        }),
      });

      // Activity events — one CUSTODY_ASSIGNED per asset, inside the tx.
      // `meta.quantity` mirrors the quantity persisted on the child Custody
      // row so reports can aggregate by units, not just rows.
      await recordEvents(
        allAssetsOfAllKits.map((asset) => ({
          organizationId,
          actorUserId: userId,
          action: "CUSTODY_ASSIGNED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          kitId: asset.kit?.id ?? undefined,
          teamMemberId: custodianId,
          targetUserId: custodianTeamMember?.user?.id ?? undefined,
          meta: {
            viaKit: true,
            ...assetQtyMeta(asset, inheritedQtyFor(asset)),
          },
        })),
        tx
      );
    });
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk checking out kits.";

    throw new ShelfError({
      cause,
      message,
      additionalData: {
        kitIds,
        organizationId,
        userId,
        custodianId,
        custodianName,
      },
      label,
    });
  }
}

export async function bulkReleaseKitCustody({
  kitIds,
  organizationId,
  userId,
  currentSearchParams,
}: {
  kitIds: Kit["id"][];
  organizationId: Kit["organizationId"];
  userId: User["id"];
  currentSearchParams?: string | null;
}) {
  try {
    /** If we are selecting all, then we have to consider filters */
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    /**
     * To make notes and release assets of kits we have to make this query.
     *
     * Kit assets come through the `AssetKit` pivot; we pull each asset
     * row via `assetKits.asset` and re-attach the parent kit's
     * `{ id, name }` to it so the downstream note creation can render
     * a kit link without changing shape.
     */
    const [kitRows, user] = await Promise.all([
      db.kit.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          custody: {
            select: { id: true, custodian: { include: { user: true } } },
          },
          assetKits: {
            select: {
              asset: {
                select: {
                  id: true,
                  status: true,
                  title: true,
                  // type + unitOfMeasure power the qty-tracked unit count in
                  // the release note ("custody of 50 units"); the count comes
                  // from the released Custody rows captured in the tx below.
                  type: true,
                  unitOfMeasure: true,
                  custody: { select: { id: true } },
                },
              },
            },
          },
        },
      }),
      getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      }),
    ]);

    // Flatten pivot rows back into kit-shaped {..., assets: [...]} so the
    // existing code path reads the same. Each asset carries a
    // synthetic `kit` field used for the note-link rendering below.
    const kits = kitRows.map((kit) => ({
      ...kit,
      assets: (kit.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kit: { id: kit.id, name: kit.name },
      })),
    }));

    const custodian = kits[0].custody?.custodian;

    /** Kits will be released only if all the selected kits are IN_CUSTODY */
    const allKitsInCustody = kits.every((kit) => kit.status === "IN_CUSTODY");
    if (!allKitsInCustody) {
      throw new ShelfError({
        cause: null,
        message:
          "There are some kits which are not in custody. Please make sure you are only selecting kits in custody to release them.",
        label,
      });
    }

    const allAssetsOfAllKits = kits.flatMap((kit) => kit.assets);

    return await db.$transaction(async (tx) => {
      /**
       * Capture the kit-allocated Custody rows BEFORE the cascade fires so we
       * can emit one `CUSTODY_RELEASED` event per row. Filtering by the
       * KitCustody IDs (rather than just `assetId`) keeps operator-assigned
       * custody on the same assets safe — it has `kitCustodyId IS NULL` and
       * is not affected by the cascade.
       */
      const kitCustodyRows = await tx.kitCustody.findMany({
        where: { kitId: { in: kits.map((kit) => kit.id) } },
        select: { id: true, kitId: true, custodianId: true },
      });
      const releasedCustodyRows =
        kitCustodyRows.length > 0
          ? await tx.custody.findMany({
              where: {
                kitCustodyId: { in: kitCustodyRows.map((kc) => kc.id) },
              },
              select: {
                assetId: true,
                teamMemberId: true,
                kitCustodyId: true,
                // Units this kit released — drives the qty-tracked count in
                // the CUSTODY_RELEASED event meta + the release note below.
                quantity: true,
              },
            })
          : [];

      // Map each released asset back to its kit (for the kitId field on the
      // event). This is one tiny lookup map; we already have everything in
      // memory.
      const kitIdByKitCustodyId = new Map(
        kitCustodyRows.map((kc) => [kc.id, kc.kitId])
      );

      // Asset shape (type / unitOfMeasure) and released-quantity per asset,
      // keyed by id, for the qty-tracked unit count in the event + note.
      const assetById = new Map(allAssetsOfAllKits.map((a) => [a.id, a]));
      const releasedQtyByAssetId = new Map(
        releasedCustodyRows.map((row) => [row.assetId, row.quantity])
      );

      // Activity events emitted FIRST so they roll back atomically with the
      // mutation if anything below fails. Cascade-driven deletes happen
      // after this point.
      if (releasedCustodyRows.length > 0) {
        await recordEvents(
          releasedCustodyRows.map((row) => {
            const asset = assetById.get(row.assetId);
            return {
              organizationId,
              actorUserId: userId,
              action: "CUSTODY_RELEASED" as const,
              entityType: "ASSET" as const,
              entityId: row.assetId,
              assetId: row.assetId,
              kitId: row.kitCustodyId
                ? kitIdByKitCustodyId.get(row.kitCustodyId)
                : undefined,
              teamMemberId: row.teamMemberId,
              targetUserId: custodian?.user?.id ?? undefined,
              meta: {
                viaKit: true,
                ...(asset ? assetQtyMeta(asset, row.quantity) : {}),
              },
            };
          }),
          tx
        );
      }

      /**
       * Deleting all custodies of kits — FK cascade (kitCustodyId on Custody)
       * removes the child Custody rows automatically, so no explicit
       * `tx.custody.deleteMany` is needed any more.
       */
      await tx.kitCustody.deleteMany({
        where: {
          kitId: { in: kits.map((kit) => kit.id) },
        },
      });

      /** Updating status of all kits to AVAILABLE */
      await tx.kit.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `kits` ids come from the org-scoped findMany above (where includes organizationId via getKitsWhereInput / line 1376)
        where: { id: { in: kits.map((kit) => kit.id) } },
        data: { status: KitStatus.AVAILABLE },
      });

      /**
       * Only flip assets to AVAILABLE if no operator-assigned custody
       * remains. Direct per-unit custody (kitCustodyId IS NULL) keeps the
       * asset IN_CUSTODY for that custodian.
       */
      const allAssetIds = allAssetsOfAllKits.map((asset) => asset.id);
      const stillCustodied = await tx.custody.findMany({
        where: { assetId: { in: allAssetIds } },
        select: { assetId: true },
      });
      const stillCustodiedIds = new Set(stillCustodied.map((c) => c.assetId));
      const assetsToFlipAvailable = allAssetIds.filter(
        (id) => !stillCustodiedIds.has(id)
      );
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetsToFlipAvailable` derive from `allAssetsOfAllKits` loaded via the org-scoped kits findMany earlier in this flow
          where: { id: { in: assetsToFlipAvailable } },
          data: { status: AssetStatus.AVAILABLE },
        });
      }

      /** Creating notes for all the assets */
      const actor = wrapUserLinkForNote({
        id: userId,
        firstName: user?.firstName,
        lastName: user?.lastName,
      });
      const custodianDisplay = custodian
        ? wrapCustodianForNote({ teamMember: custodian })
        : "**Unknown Custodian**";
      await tx.note.createMany({
        data: allAssetsOfAllKits.map((asset) => {
          const kitLink = asset.kit
            ? wrapLinkForNote(`/kits/${asset.kit.id}`, asset.kit.name.trim())
            : "**Unknown Kit**";
          // qty-tracked assets name the units released ("custody of 50
          // units"); INDIVIDUAL phrasing is unchanged.
          const count = formatUnitCount(
            asset,
            releasedQtyByAssetId.get(asset.id)
          );
          const custodyPhrase = count ? `custody of ${count}` : "custody";
          return {
            content: `${actor} released ${custodianDisplay}'s ${custodyPhrase} via kit assignment ${kitLink}.`,
            type: "UPDATE",
            userId,
            assetId: asset.id,
          };
        }),
      });
    });
  } catch (cause) {
    const message =
      cause instanceof ShelfError
        ? cause.message
        : "Something went wrong while bulk releasing kits.";

    throw new ShelfError({
      cause,
      message,
      additionalData: { kitIds, organizationId, userId },
      label,
    });
  }
}

export async function createKitsIfNotExists({
  data,
  userId,
  organizationId,
}: {
  data: CreateAssetFromContentImportPayload[];
  userId: User["id"];
  organizationId: Organization["id"];
}): Promise<Record<string, Kit>> {
  try {
    // first we get all the kits from the assets and make then into an object where the category is the key and the value is an empty string
    // Normalize kit names so whitespace-only or padded values don't create phantom keys.
    const kitNames = Array.from(
      new Set(
        data
          .map((asset) => asset.kit?.trim())
          .filter((kit): kit is string => !!kit)
      )
    );

    // Handle the case where there are no kits
    if (kitNames.length === 0) {
      return {};
    }

    // now we loop through the kits and check if they exist
    const kits = new Map<string, Kit>();
    for (const kit of kitNames) {
      const existingKit = await db.kit.findFirst({
        where: {
          name: { equals: kit, mode: "insensitive" },
          organizationId,
        },
      });

      if (!existingKit) {
        // if the location doesn't exist, we create a new one
        const newKit = await db.kit.create({
          data: {
            name: kit.trim(),
            createdBy: {
              connect: {
                id: userId,
              },
            },
            organization: {
              connect: {
                id: organizationId,
              },
            },
          },
        });
        kits.set(kit, newKit);
      } else {
        // if the location exists, we just update the id
        kits.set(kit, existingKit);
      }
    }

    return Object.fromEntries(Array.from(kits));
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating kits. Seems like some of the location data in your import file is invalid. Please check and try again.",
      additionalData: { userId, organizationId },
      label,
      /** No need to capture those. They are mostly related to malformed CSV data */
      shouldBeCaptured: false,
    });
  }
}

export async function updateKitQrCode({
  kitId,
  newQrId,
  organizationId,
}: {
  organizationId: string;
  kitId: string;
  newQrId: string;
}) {
  try {
    // Disconnect all existing QR codes
    await db.kit
      .update({
        where: { id: kitId, organizationId },
        data: {
          qrCodes: {
            set: [],
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Couldn't disconnect existing codes",
          label,
          additionalData: { kitId, organizationId, newQrId },
        });
      });

    // Connect the new QR code
    return await db.kit
      .update({
        where: { id: kitId, organizationId },
        data: {
          qrCodes: {
            connect: { id: newQrId },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Couldn't connect the new QR code",
          label,
          additionalData: { kitId, organizationId, newQrId },
        });
      });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating kit QR code",
      label,
      additionalData: { kitId, organizationId, newQrId },
    });
  }
}

/**
 * Relinks a kit to a different QR code, unlinking any previous code.
 * Throws when the QR belongs to another org or is already linked to an asset/kit.
 */
export async function relinkKitQrCode({
  qrId,
  kitId,
  organizationId,
  userId,
}: {
  qrId: Qr["id"];
  kitId: Kit["id"];
  organizationId: Organization["id"];
  userId: User["id"];
}) {
  const [qr, kit] = await Promise.all([
    getQr({ id: qrId }),
    db.kit.findFirst({
      where: { id: kitId, organizationId },
      select: { qrCodes: { select: { id: true } } },
    }),
  ]);

  if (!kit) {
    throw new ShelfError({
      cause: null,
      message: "Kit not found.",
      label,
      additionalData: { kitId, organizationId, qrId },
      shouldBeCaptured: false,
    });
  }

  if (qr.organizationId && qr.organizationId !== organizationId) {
    throw new ShelfError({
      cause: null,
      title: "QR not valid.",
      message: "This QR code does not belong to your organization",
      label,
      status: 403,
      shouldBeCaptured: false,
    });
  }

  if (qr.assetId) {
    throw new ShelfError({
      cause: null,
      title: "QR already linked.",
      message:
        "You cannot link to this code because its already linked to another asset. Delete the other asset to free up the code and try again.",
      label,
      shouldBeCaptured: false,
    });
  }

  if (qr.kitId && qr.kitId !== kitId) {
    throw new ShelfError({
      cause: null,
      title: "QR already linked.",
      message:
        "You cannot link to this code because its already linked to another kit. Delete the other kit to free up the code and try again.",
      label,
      shouldBeCaptured: false,
    });
  }

  const oldQrCode = kit.qrCodes[0];

  await Promise.all([
    db.qr.update({
      // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: qr.organizationId checked against caller's organizationId above (guard at the `qr.organizationId && qr.organizationId !== organizationId` throw); null-org QR is a claimable code being assigned here
      where: { id: qr.id },
      data: { organizationId, userId },
    }),
    updateKitQrCode({
      kitId,
      newQrId: qr.id,
      organizationId,
    }),
  ]);

  return {
    oldQrCodeId: oldQrCode?.id,
    newQrId: qr.id,
  };
}

/**
 * Resolves the asset IDs contained in the given kits, for adding to a booking.
 *
 * `organizationId` is required and scopes the kit lookup so a caller cannot
 * pull assets out of kits belonging to another tenant (cross-org IDOR). Kits
 * not in the org simply yield no assets.
 *
 * @param kitIds - Kit IDs sourced from request input
 * @param organizationId - Caller's validated organization ID
 * @returns Asset IDs belonging to the in-org kits
 * @throws {ShelfError} on DB failure
 */
export async function getAvailableKitAssetForBooking(
  kitIds: Kit["id"][],
  organizationId: string
): Promise<string[]> {
  try {
    const selectedKits = await db.kit.findMany({
      // why: organizationId scoping prevents cross-org IDOR — without it a
      // caller in Org A could resolve assets from Org B's kits.
      where: { id: { in: kitIds }, organizationId },
      select: {
        assetKits: {
          select: { asset: { select: { id: true, status: true } } },
        },
      },
    });

    const allAssets = selectedKits.flatMap((kit) =>
      (kit.assetKits ?? []).map((ak) => ak.asset)
    );

    return allAssets.map((asset) => asset.id);
  } catch (cause: any) {
    throw new ShelfError({
      cause: cause,
      message:
        cause?.message ||
        "Something went wrong while getting available assets.",
      label: "Assets",
    });
  }
}

export async function updateKitLocation({
  id,
  organizationId,
  currentLocationId,
  newLocationId,
  userId,
}: {
  id: Kit["id"];
  organizationId: Kit["organizationId"];
  currentLocationId: Kit["locationId"];
  newLocationId: Kit["locationId"];
  userId?: User["id"];
}) {
  try {
    // Get kit with its assets first. Read each asset's placement from
    // the AssetLocation pivot; pull `type` and `quantity` so the cascade
    // can write a type-aware quantity into the new pivot row. Also pull
    // `unitOfMeasure` (qty-tracked unit label) and the per-row
    // `AssetKit.quantity` (the slice this kit holds — copied into the
    // kit-driven AssetLocation row) so the cascade note/event can name the
    // affected unit count.
    const kitRow = await db.kit.findUnique({
      where: { id, organizationId },
      select: {
        id: true,
        name: true,
        assetKits: {
          select: {
            quantity: true,
            asset: {
              select: {
                id: true,
                title: true,
                type: true,
                quantity: true,
                unitOfMeasure: true,
                assetLocations: {
                  select: { location: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!kitRow) {
      throw new ShelfError({
        cause: null,
        message: "Kit not found",
        label,
        shouldBeCaptured: false,
      });
    }

    // Flatten pivot rows into the in-memory `assets` shape used below.
    // `kitQuantity` is this kit's per-row `AssetKit.quantity` (NOT the
    // asset's full pool) — the slice cascaded into the kit-driven location
    // row, surfaced in the per-asset cascade note/event count.
    const kit = {
      ...kitRow,
      assets: (kitRow.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kitQuantity: ak.quantity,
      })),
    };

    const assetIds = kit.assets.map((asset) => asset.id);

    if (newLocationId) {
      // Only emit events for assets whose location actually changes.
      const assetsWithLocationChange = kit.assets.filter(
        (asset) => (getPrimaryLocation(asset)?.id ?? null) !== newLocationId
      );

      // Lifted out of the tx so the post-tx note loop can also use it
      // (without re-running the manual-row probe). Populated inside the tx
      // once the filtered `dataToCreate` is built.
      let cascadedAssetIds = new Set<string>();

      // Connect kit to the new location AND cascade per-asset placement via
      // the AssetLocation pivot, atomically with the per-asset
      // ASSET_LOCATION_CHANGED events. The DEFERRED
      // `enforce_asset_location_sum_within_total` trigger re-checks at COMMIT.
      await db.$transaction(async (tx) => {
        // newLocationId comes from request input — prove it belongs to the
        // caller's org before connecting kit/assets to it (cross-org IDOR).
        await assertLocationBelongsToOrg(
          { locationId: newLocationId, organizationId },
          tx
        );
        await tx.location.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: newLocationId proven org-owned by assertLocationBelongsToOrg above (same tx)
          where: { id: newLocationId },
          data: {
            kits: {
              connect: { id },
            },
          },
        });

        if (assetIds.length > 0) {
          // Only touch kit-driven rows (the ones whose `assetKit.kitId`
          // matches this kit). Manual placements belong to the user and
          // survive a kit-location change. Drop existing kit-driven rows
          // for this kit, then re-create them at the new location with
          // `assetKitId` set so the discriminator survives.
          await tx.assetLocation.deleteMany({
            where: { assetKit: { kitId: id } },
          });
          const assetKitsForKit = await tx.assetKit.findMany({
            where: { kitId: id },
            select: { id: true, assetId: true, quantity: true },
          });
          // Skip INDIVIDUAL assets that already hold a manual
          // AssetLocation row (`assetKitId IS NULL`). The
          // `enforce_individual_asset_single_location` trigger
          // (packages/database/prisma/migrations/20260519143054_add_asset_location_pivot/migration.sql)
          // permits at most one AssetLocation row per INDIVIDUAL asset:
          // manual placements override kit-driven cascades for
          // INDIVIDUAL assets — they can hold at most one
          // AssetLocation row.
          const manualAssetIds = new Set(
            (
              await tx.assetLocation.findMany({
                where: {
                  assetId: { in: assetKitsForKit.map((ak) => ak.assetId) },
                  assetKitId: null,
                  asset: { type: "INDIVIDUAL" },
                },
                select: { assetId: true },
              })
            ).map((r) => r.assetId)
          );
          const dataToCreate = assetKitsForKit
            .filter((ak) => !manualAssetIds.has(ak.assetId))
            .map((ak) => ({
              assetId: ak.assetId,
              locationId: newLocationId,
              organizationId,
              quantity: ak.quantity,
              assetKitId: ak.id,
            }));
          // Track which assets actually got a kit-driven row so the
          // audit-trail (events + per-asset notes) matches the persisted
          // state — skipped manual-placement assets must not appear.
          cascadedAssetIds = new Set(dataToCreate.map((row) => row.assetId));
          if (dataToCreate.length > 0) {
            await tx.assetLocation.createMany({ data: dataToCreate });
          }
        }

        // why: skipped INDIVIDUAL assets (pinned by a manual AssetLocation
        // row) don't actually move with the kit — exclude them from the
        // activity event so the audit trail matches the persisted state.
        const cascadedAssetsForEvents = assetsWithLocationChange.filter(
          (asset) => cascadedAssetIds.has(asset.id)
        );

        if (userId && cascadedAssetsForEvents.length > 0) {
          await recordEvents(
            cascadedAssetsForEvents.map((asset) => ({
              organizationId,
              actorUserId: userId,
              action: "ASSET_LOCATION_CHANGED" as const,
              entityType: "ASSET" as const,
              entityId: asset.id,
              assetId: asset.id,
              kitId: id,
              locationId: newLocationId,
              field: "locationId",
              fromValue: getPrimaryLocation(asset)?.id ?? null,
              toValue: newLocationId,
              // `meta.quantity` (qty-tracked only) = the per-row
              // `AssetKit.quantity` cascaded into the kit-driven location row.
              meta: { viaKit: true, ...assetQtyMeta(asset, asset.kitQuantity) },
            })),
            tx
          );
        }
      });

      // Add notes to assets about location update via parent kit
      // why: skipped INDIVIDUAL assets (pinned by a manual AssetLocation
      // row) don't actually move with the kit — exclude them from the
      // per-asset note so the audit trail matches the persisted state.
      const cascadedAssetsForNotes = kit.assets.filter((asset) =>
        cascadedAssetIds.has(asset.id)
      );
      if (userId && cascadedAssetsForNotes.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const location = await db.location.findFirst({
          where: { id: newLocationId, organizationId },
          select: { name: true, id: true },
        });

        // Create individual notes for each asset
        await Promise.all(
          cascadedAssetsForNotes.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: getPrimaryLocation(asset), // Use the asset's current location
                newLocation: location,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: false,
                // Qty-tracked cascade names the kit's per-row slice
                // ("placed 50 units … via parent kit assignment").
                type: asset.type,
                unitOfMeasure: asset.unitOfMeasure,
                quantity: asset.kitQuantity,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
              // why: asset belongs to this kit (loaded scoped to
              // organizationId) — pass the kit's org so the note is
              // validated against the asset's true org
              organizationId,
            })
          )
        );
      }
    } else if (!newLocationId && currentLocationId) {
      // Only emit events for assets that actually had this kit's location.
      const assetsWithLocationChange = kit.assets.filter(
        (asset) => getPrimaryLocation(asset)?.id === currentLocationId
      );

      // Disconnect kit from the old location AND drop per-asset placement
      // via the AssetLocation pivot, atomically with the per-asset
      // ASSET_LOCATION_CHANGED events.
      await db.$transaction(async (tx) => {
        // currentLocationId is supplied by the caller — prove it belongs to
        // the caller's org before disconnecting kit/assets (cross-org IDOR).
        await assertLocationBelongsToOrg(
          { locationId: currentLocationId, organizationId },
          tx
        );
        await tx.location.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: currentLocationId proven org-owned by assertLocationBelongsToOrg above (same tx)
          where: { id: currentLocationId },
          data: {
            kits: {
              disconnect: { id },
            },
          },
        });

        if (assetIds.length > 0) {
          // Only delete kit-driven rows for THIS kit. Manual rows
          // survive (the user's own placements aren't unset just
          // because the kit lost its location).
          await tx.assetLocation.deleteMany({
            where: { assetKit: { kitId: id } },
          });
        }

        if (userId && assetsWithLocationChange.length > 0) {
          await recordEvents(
            assetsWithLocationChange.map((asset) => ({
              organizationId,
              actorUserId: userId,
              action: "ASSET_LOCATION_CHANGED" as const,
              entityType: "ASSET" as const,
              entityId: asset.id,
              assetId: asset.id,
              kitId: id,
              field: "locationId",
              fromValue: currentLocationId,
              toValue: null,
              // `meta.quantity` (qty-tracked only) = the per-row
              // `AssetKit.quantity` removed with the kit-driven location row.
              meta: { viaKit: true, ...assetQtyMeta(asset, asset.kitQuantity) },
            })),
            tx
          );
        }
      });

      // Add notes to assets about location removal via parent kit
      if (userId && assetIds.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const currentLocation = await db.location.findFirst({
          where: { id: currentLocationId, organizationId },
          select: { name: true, id: true },
        });

        // Create individual notes for each asset
        await Promise.all(
          kit.assets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                // Prefer the asset's own pivot row (covers cases where the
                // asset was unplaced or at a different location than the
                // kit's `currentLocationId` — defensive consistency).
                currentLocation: getPrimaryLocation(asset) ?? currentLocation,
                newLocation: null,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: true,
                // Qty-tracked cascade names the kit's per-row slice
                // ("removed 50 units … via parent kit removal").
                type: asset.type,
                unitOfMeasure: asset.unitOfMeasure,
                quantity: asset.kitQuantity,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
              // why: asset belongs to this kit (loaded scoped to
              // organizationId) — pass the kit's org so the note is
              // validated against the asset's true org
              organizationId,
            })
          )
        );
      }
    }

    // Return the updated kit
    return await db.kit.findUnique({
      where: { id, organizationId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating kit location",
      label,
    });
  }
}

export async function bulkUpdateKitLocation({
  kitIds,
  organizationId,
  newLocationId,
  currentSearchParams,
  userId,
}: {
  kitIds: Array<Kit["id"]>;
  organizationId: Kit["organizationId"];
  newLocationId: Kit["locationId"];
  currentSearchParams?: string | null;
  userId: User["id"];
}) {
  try {
    const where: Prisma.KitWhereInput = kitIds.includes(ALL_SELECTED_KEY)
      ? getKitsWhereInput({ organizationId, currentSearchParams })
      : { id: { in: kitIds }, organizationId };

    // Get kits with their assets before updating. Read each asset's
    // placement from the AssetLocation pivot and pull `type` + `quantity`
    // so the cascade writes type-aware rows; flatten back into a
    // `.assets` shape downstream. `unitOfMeasure` + the per-row
    // `AssetKit.quantity` let the cascade note/event surface the affected
    // unit count for qty-tracked assets.
    const kitsWithAssetsRows = await db.kit.findMany({
      where,
      select: {
        id: true,
        name: true,
        locationId: true,
        location: { select: { id: true, name: true } },
        assetKits: {
          select: {
            quantity: true,
            asset: {
              select: {
                id: true,
                title: true,
                type: true,
                quantity: true,
                unitOfMeasure: true,
                assetLocations: {
                  select: { location: { select: { id: true, name: true } } },
                },
              },
            },
          },
        },
      },
    });

    // Flatten pivot rows back into a kit-shaped `.assets` array so the
    // rest of this function reads as it did pre-pivot. `kitQuantity` is the
    // per-row `AssetKit.quantity` (this kit's slice, copied into the
    // kit-driven location row) — NOT the asset's full pool.
    const kitsWithAssets = kitsWithAssetsRows.map((kit) => ({
      ...kit,
      assets: (kit.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kitQuantity: ak.quantity,
      })),
    }));

    const actualKitIds = kitsWithAssets.map((kit) => kit.id);
    const allAssets = kitsWithAssets.flatMap((kit) => kit.assets);
    // Map asset.id → owning kit.id so we can attach `kitId` to each cascade event.
    const kitIdByAssetId = new Map<string, string>();
    for (const kit of kitsWithAssets) {
      for (const asset of kit.assets) {
        kitIdByAssetId.set(asset.id, kit.id);
      }
    }

    if (
      newLocationId &&
      newLocationId.trim() !== "" &&
      actualKitIds.length > 0
    ) {
      // Only emit events for assets whose location actually changes.
      const assetsWithLocationChange = allAssets.filter(
        (asset) => (getPrimaryLocation(asset)?.id ?? null) !== newLocationId
      );

      // Lifted out of the tx so the post-tx per-asset note loop can also use it
      // (without re-running the manual-row probe). Populated inside the tx
      // once the filtered `dataToCreate` is built.
      let cascadedAssetIds = new Set<string>();

      // Connect kits to the new location AND cascade per-asset placement via
      // the AssetLocation pivot, atomically with the per-asset
      // ASSET_LOCATION_CHANGED events. The DEFERRED
      // `enforce_asset_location_sum_within_total` trigger re-checks at COMMIT.
      await db.$transaction(async (tx) => {
        // newLocationId comes from request input — prove it belongs to the
        // caller's org before connecting kits/assets to it (cross-org IDOR).
        await assertLocationBelongsToOrg(
          { locationId: newLocationId, organizationId },
          tx
        );
        await tx.location.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: newLocationId proven org-owned by assertLocationBelongsToOrg above (same tx)
          where: { id: newLocationId },
          data: {
            kits: {
              connect: actualKitIds.map((id) => ({ id })),
            },
          },
        });

        if (allAssets.length > 0) {
          // Only touch kit-driven rows whose `assetKit.kitId` is in
          // the bulk set. Manual placements survive. Drop existing
          // kit-driven rows then re-create at the new location with
          // `assetKitId` set.
          await tx.assetLocation.deleteMany({
            where: { assetKit: { kitId: { in: actualKitIds } } },
          });
          const assetKitsForKits = await tx.assetKit.findMany({
            where: { kitId: { in: actualKitIds } },
            select: { id: true, assetId: true, quantity: true },
          });
          // Skip INDIVIDUAL assets that already hold a manual
          // AssetLocation row (`assetKitId IS NULL`). The
          // `enforce_individual_asset_single_location` trigger
          // (packages/database/prisma/migrations/20260519143054_add_asset_location_pivot/migration.sql)
          // permits at most one AssetLocation row per INDIVIDUAL asset:
          // manual placements override kit-driven cascades for
          // INDIVIDUAL assets — they can hold at most one
          // AssetLocation row.
          const manualAssetIds = new Set(
            (
              await tx.assetLocation.findMany({
                where: {
                  assetId: { in: assetKitsForKits.map((ak) => ak.assetId) },
                  assetKitId: null,
                  asset: { type: "INDIVIDUAL" },
                },
                select: { assetId: true },
              })
            ).map((r) => r.assetId)
          );
          const dataToCreate = assetKitsForKits
            .filter((ak) => !manualAssetIds.has(ak.assetId))
            .map((ak) => ({
              assetId: ak.assetId,
              locationId: newLocationId,
              organizationId,
              quantity: ak.quantity,
              assetKitId: ak.id,
            }));
          // Track which assets actually got a kit-driven row so the
          // audit-trail (events + per-asset notes) matches the persisted
          // state — skipped manual-placement assets must not appear.
          cascadedAssetIds = new Set(dataToCreate.map((row) => row.assetId));
          if (dataToCreate.length > 0) {
            await tx.assetLocation.createMany({ data: dataToCreate });
          }
        }

        // why: skipped INDIVIDUAL assets (pinned by a manual AssetLocation
        // row) don't actually move with the kit — exclude them from the
        // activity event so the audit trail matches the persisted state.
        const cascadedAssetsForEvents = assetsWithLocationChange.filter(
          (asset) => cascadedAssetIds.has(asset.id)
        );

        if (cascadedAssetsForEvents.length > 0) {
          await recordEvents(
            cascadedAssetsForEvents.map((asset) => ({
              organizationId,
              actorUserId: userId,
              action: "ASSET_LOCATION_CHANGED" as const,
              entityType: "ASSET" as const,
              entityId: asset.id,
              assetId: asset.id,
              kitId: kitIdByAssetId.get(asset.id),
              locationId: newLocationId,
              field: "locationId",
              fromValue: getPrimaryLocation(asset)?.id ?? null,
              toValue: newLocationId,
              // `meta.quantity` (qty-tracked only) = the per-row
              // `AssetKit.quantity` cascaded into the kit-driven location row.
              meta: { viaKit: true, ...assetQtyMeta(asset, asset.kitQuantity) },
            })),
            tx
          );
        }
      });

      // Create notes for affected assets
      // why: skipped INDIVIDUAL assets (pinned by a manual AssetLocation
      // row) don't actually move with the kit — exclude them from the
      // per-asset note so the audit trail matches the persisted state.
      // (Kit-level system notes below are emitted per-kit and remain
      // unfiltered — they describe the kit-level movement, not asset rows.)
      const cascadedAssetsForNotes = allAssets.filter((asset) =>
        cascadedAssetIds.has(asset.id)
      );
      if (cascadedAssetsForNotes.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });
        const location = await db.location.findFirst({
          where: { id: newLocationId, organizationId },
          select: { name: true, id: true },
        });

        // Create individual notes for each asset
        await Promise.all(
          cascadedAssetsForNotes.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: getPrimaryLocation(asset),
                newLocation: location,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: false,
                // Qty-tracked cascade names the kit's per-row slice.
                type: asset.type,
                unitOfMeasure: asset.unitOfMeasure,
                quantity: asset.kitQuantity,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
              // why: asset belongs to a kit loaded scoped to
              // organizationId — pass the org so the note is validated
              // against the asset's true org
              organizationId,
            })
          )
        );
      }
    } else {
      // Only assets that currently have a location actually change.
      const assetsWithLocationChange = allAssets.filter(
        (asset) => getPrimaryLocation(asset)?.id
      );

      // Removing location - clear the kit FK and the per-asset pivot rows,
      // atomically with the per-asset ASSET_LOCATION_CHANGED events.
      await db.$transaction(async (tx) => {
        await tx.kit.updateMany({
          where,
          data: { locationId: null },
        });

        if (allAssets.length > 0) {
          // Only drop kit-driven rows for THIS batch of kits. Manual
          // rows survive — clearing the kits' location doesn't undo
          // the user's own placements.
          await tx.assetLocation.deleteMany({
            where: { assetKit: { kitId: { in: actualKitIds } } },
          });
        }

        if (assetsWithLocationChange.length > 0) {
          await recordEvents(
            assetsWithLocationChange.map((asset) => ({
              organizationId,
              actorUserId: userId,
              action: "ASSET_LOCATION_CHANGED" as const,
              entityType: "ASSET" as const,
              entityId: asset.id,
              assetId: asset.id,
              kitId: kitIdByAssetId.get(asset.id),
              field: "locationId",
              fromValue: getPrimaryLocation(asset)!.id,
              toValue: null,
              // `meta.quantity` (qty-tracked only) = the per-row
              // `AssetKit.quantity` removed with the kit-driven location row.
              meta: { viaKit: true, ...assetQtyMeta(asset, asset.kitQuantity) },
            })),
            tx
          );
        }
      });

      // Create individual notes for each asset (asset locations were already
      // cleared atomically in the transaction above).
      if (allAssets.length > 0) {
        const user = await getUserByID(userId, {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            displayName: true,
          } satisfies Prisma.UserSelect,
        });

        await Promise.all(
          allAssets.map((asset) =>
            createNote({
              content: getKitLocationUpdateNoteContent({
                currentLocation: getPrimaryLocation(asset),
                newLocation: null,
                userId,
                firstName: user?.firstName ?? "",
                lastName: user?.lastName ?? "",
                isRemoving: true,
                // Qty-tracked cascade names the kit's per-row slice.
                type: asset.type,
                unitOfMeasure: asset.unitOfMeasure,
                quantity: asset.kitQuantity,
              }),
              type: "UPDATE",
              userId,
              assetId: asset.id,
              // why: asset belongs to a kit loaded scoped to
              // organizationId — pass the org so the note is validated
              // against the asset's true org
              organizationId,
            })
          )
        );
      }
    }

    // Create location activity notes
    const userForNote = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName: userForNote?.firstName,
      lastName: userForNote?.lastName,
    });

    if (newLocationId && newLocationId.trim() !== "") {
      const location = await db.location.findFirst({
        where: { id: newLocationId, organizationId },
        select: { id: true, name: true },
      });

      if (location) {
        const locLink = wrapLinkForNote(
          `/locations/${location.id}`,
          location.name
        );

        // Only count kits not already at the target location
        const actuallyMovedKits = kitsWithAssets.filter(
          (k) => k.locationId !== newLocationId
        );

        if (actuallyMovedKits.length > 0) {
          const kitData = actuallyMovedKits.map((k) => ({
            id: k.id,
            name: k.name,
          }));
          const kitMarkup = wrapKitsWithDataForNote(kitData, "added");
          await createSystemLocationNote({
            locationId: location.id,
            content: `${userLink} added ${kitMarkup} to ${locLink}.`,
            userId,
          });
        }

        // Removal notes on previous locations
        const byPrevLoc = new Map<
          string,
          { name: string; kits: Array<{ id: string; name: string }> }
        >();
        for (const kit of actuallyMovedKits) {
          if (!kit.locationId || kit.locationId === newLocationId) continue;
          const prevLocName = kit.location?.name ?? "Unknown location";
          const prevLocId = kit.locationId;
          const existing = byPrevLoc.get(prevLocId);
          if (existing) {
            existing.kits.push({ id: kit.id, name: kit.name });
          } else {
            byPrevLoc.set(prevLocId, {
              name: prevLocName,
              kits: [{ id: kit.id, name: kit.name }],
            });
          }
        }
        for (const [locId, { name, kits }] of byPrevLoc) {
          const prevLocLink = wrapLinkForNote(`/locations/${locId}`, name);
          const kitMarkup = wrapKitsWithDataForNote(kits, "removed");
          const movedTo = ` Moved to ${locLink}.`;
          await createSystemLocationNote({
            locationId: locId,
            content: `${userLink} removed ${kitMarkup} from ${prevLocLink}.${movedTo}`,
            userId,
          });
        }
      }
    } else {
      // Kits removed from location — create removal notes
      const byPrevLoc = new Map<
        string,
        { name: string; kits: Array<{ id: string; name: string }> }
      >();
      for (const kit of kitsWithAssets) {
        if (!kit.locationId) continue;
        const prevLocName = kit.location?.name ?? "Unknown location";
        const existing = byPrevLoc.get(kit.locationId);
        if (existing) {
          existing.kits.push({ id: kit.id, name: kit.name });
        } else {
          byPrevLoc.set(kit.locationId, {
            name: prevLocName,
            kits: [{ id: kit.id, name: kit.name }],
          });
        }
      }
      for (const [locId, { name, kits }] of byPrevLoc) {
        const prevLocLink = wrapLinkForNote(`/locations/${locId}`, name);
        const kitMarkup = wrapKitsWithDataForNote(kits, "removed");
        await createSystemLocationNote({
          locationId: locId,
          content: `${userLink} removed ${kitMarkup} from ${prevLocLink}.`,
          userId,
        });
      }
    }

    return { count: actualKitIds.length };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while updating kit location",
      label,
    });
  }
}

export async function updateKitAssets({
  kitId,
  organizationId,
  userId,
  assetIds,
  assetQuantities = {},
  request,
  addOnly = false,
}: {
  kitId: Kit["id"];
  organizationId: Organization["id"];
  userId: User["id"];
  assetIds: Asset["id"][];
  /**
   * Per-asset quantity for QUANTITY_TRACKED rows in the picker. Missing
   * entries default to the asset's full pool (today's "kit owns the
   * whole asset" semantics). INDIVIDUAL assets always write quantity = 1
   * regardless of this map.
   */
  assetQuantities?: Record<Asset["id"], number>;
  request: Request;
  addOnly?: boolean; // If true, only add assets, don't remove existing ones
}) {
  try {
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });

    const kitWithRelations = await db.kit
      .findUniqueOrThrow({
        where: { id: kitId, organizationId },
        include: {
          location: { select: { id: true, name: true } },
          // Each pivot row carries the kitId (denormalised) so the
          // `asset.kit?.id` checks downstream can map to
          // `asset.assetKits[0]?.kitId`.
          assetKits: {
            select: {
              kitId: true,
              // This kit's per-row slice — surfaced in the membership-remove
              // note + ASSET_KIT_CHANGED event ("removed 50 units from ...").
              // This is AssetKit.quantity, NOT Asset.quantity.
              quantity: true,
              asset: {
                select: {
                  id: true,
                  title: true,
                  // type + unitOfMeasure label the qty-tracked unit count in
                  // the membership-remove custody-release note.
                  type: true,
                  unitOfMeasure: true,
                  assetKits: { select: { kitId: true } },
                  bookingAssets: {
                    include: {
                      booking: { select: { id: true, status: true } },
                    },
                  },
                },
              },
            },
          },
          custody: {
            select: {
              id: true,
              custodian: {
                select: {
                  id: true,
                  name: true,
                  user: {
                    select: {
                      id: true,
                      email: true,
                      firstName: true,
                      lastName: true,
                      displayName: true,
                      profilePicture: true,
                    },
                  },
                },
              },
            },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "Kit not found",
          additionalData: { kitId, userId, organizationId },
          status: 404,
          label: "Kit",
          shouldBeCaptured: !isNotFoundError(cause),
        });
      });

    // Flatten the AssetKit pivot rows back into a list of assets so the
    // rest of this function reads the same way it did pre-pivot. We carry
    // each row's `AssetKit.quantity` as `kitQuantity` onto the asset so the
    // remove note + event can name the slice held in THIS kit (NOT the
    // asset's full pool).
    const kit = {
      ...kitWithRelations,
      assets: (kitWithRelations.assetKits ?? []).map((ak) => ({
        ...ak.asset,
        kitQuantity: ak.quantity,
      })),
    };

    const kitCustodianDisplay = kit.custody?.custodian
      ? wrapCustodianForNote({ teamMember: kit.custody.custodian })
      : undefined;

    const removedAssets = kit.assets.filter(
      (asset) => !assetIds.includes(asset.id)
    );

    /**
     * If user has selected all assets, then we have to get ids of all those assets
     * with respect to the filters applied.
     * */
    const hasSelectedAll = assetIds.includes(ALL_SELECTED_KEY);
    if (hasSelectedAll) {
      const searchParams = getCurrentSearchParams(request);
      const assetsWhere = getAssetsWhereInput({
        organizationId,
        currentSearchParams: searchParams.toString(),
      });

      const allAssets = await db.asset.findMany({
        where: assetsWhere,
        select: { id: true },
      });
      const kitAssets = kit.assets.map((asset) => asset.id);
      const removedAssetsIds = removedAssets.map((asset) => asset.id);

      /**
       * New assets that needs to be added are
       * - Previously added assets
       * - All assets with applied filters
       */
      assetIds = [
        ...new Set([
          ...allAssets.map((asset) => asset.id),
          ...kitAssets.filter((asset) => !removedAssetsIds.includes(asset)),
        ]),
      ];
    }

    // Get all assets that should be in the kit (based on assetIds) with organization scoping.
    // `type` and `quantity` are required so that inheriting kit-custody on
    // qty-tracked assets writes the asset's full tracked quantity into the
    // child Custody row instead of defaulting to 1.
    const allAssetsForKit = await db.asset
      .findMany({
        where: { id: { in: assetIds }, organizationId },
        select: {
          id: true,
          title: true,
          type: true,
          quantity: true,
          // unitOfMeasure labels the qty-tracked unit count in the custody
          // grant/release notes ("custody of 50 boxes").
          unitOfMeasure: true,
          // Pull all of the asset's AssetKit rows. Pre-polish there was at
          // most one (the @@unique held); post-polish a QUANTITY_TRACKED
          // asset can be in multiple kits. We need:
          //   - kitId (cross-kit detection)
          //   - quantity (this kit's slice for qty-change diff)
          assetKits: { select: { kitId: true, quantity: true } },
          custody: true,
          // Ongoing/overdue booking allocations subtract from the strict-
          // available pool checked below — pull them here so the
          // validation pass doesn't need a second round-trip.
          bookingAssets: {
            where: {
              booking: {
                status: {
                  in: [BookingStatus.ONGOING, BookingStatus.OVERDUE],
                },
              },
            },
            select: { quantity: true },
          },
          assetLocations: {
            select: { location: { select: { id: true, name: true } } },
          },
        },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message:
            "Something went wrong while fetching the assets. Please try again or contact support.",
          additionalData: { assetIds, userId, kitId },
          label: "Kit",
        });
      });

    // Identify which assets are actually new (not already in this kit)
    const newlyAddedAssets = allAssetsForKit.filter(
      (asset) =>
        !kit.assets.some((existingAsset) => existingAsset.id === asset.id)
    );

    /**
     * The `AssetKit.quantity` each newly-added asset will hold IN THIS KIT
     * once its pivot row is created. Same derivation as the `createMany`
     * below (submitted picker qty for QUANTITY_TRACKED, falling back to the
     * asset's full pool; always 1 for INDIVIDUAL) — extracted so the add
     * note + ASSET_KIT_CHANGED event surface the same per-kit count without
     * re-reading the pivot. This is the per-row AssetKit.quantity, NOT
     * Asset.quantity.
     */
    const addedAssetKitQuantity = (asset: {
      id: string;
      type: AssetType;
      quantity: number | null;
    }): number =>
      asset.type === AssetType.QUANTITY_TRACKED
        ? Math.max(1, assetQuantities[asset.id] ?? asset.quantity ?? 1)
        : 1;

    /**
     * Detect existing-in-kit assets whose submitted quantity differs from
     * the current `AssetKit.quantity`. These trigger an `assetKit.update`
     * + (if the kit is in custody) a cascade to the kit-allocated
     * `Custody` row, with a paired `CUSTODY_ASSIGNED` (increase) or
     * `CUSTODY_RELEASED` (decrease) event.
     *
     * Today the picker doesn't yet expose a qty input, so the
     * `assetQuantities` map is typically empty and this bucket stays
     * empty too — keeps the new code path dormant until T5 wires the UI.
     */
    type QtyChangedAsset = {
      id: string;
      title: string;
      previousQuantity: number;
      newQuantity: number;
    };
    const qtyChangedAssets: QtyChangedAsset[] = allAssetsForKit.flatMap(
      (asset) => {
        // Only consider assets that are already in this kit AND have a
        // submitted quantity that differs from the current pivot value.
        const currentPivot = asset.assetKits.find((ak) => ak.kitId === kit.id);
        if (!currentPivot) return [];

        const submitted = assetQuantities[asset.id];
        if (submitted == null) return [];

        // INDIVIDUAL is always 1 — picker shouldn't submit anything else,
        // but defensively coerce.
        const newQty =
          asset.type === AssetType.INDIVIDUAL ? 1 : Math.max(0, submitted);
        if (newQty === currentPivot.quantity) return [];

        // Submitting qty=0 for an existing-in-kit asset is treated as a
        // no-op here. The picker contract is: to remove an asset from the
        // kit, omit its id from `assetIds` — that routes through
        // `removedAssets` (which deletes the pivot row + cascades to
        // kit-allocated Custody).
        if (newQty <= 0) return [];

        return [
          {
            id: asset.id,
            title: asset.title,
            previousQuantity: currentPivot.quantity,
            newQuantity: newQty,
          },
        ];
      }
    );

    /**
     * Server-side strict-available validation. The picker enforces this
     * client-side and the DEFERRED constraint trigger catches
     * over-allocation at COMMIT, but a tampered request would otherwise
     * surface as a generic 500. Re-check the strict-available pool here
     * for any qty-tracked submission and return a clean 400.
     *
     * Strict-available formula (matches the picker loader):
     *   spaceWithoutMe = Asset.quantity
     *                  − sum(other kits' AssetKit.quantity)
     *                  − sum(operator-only Custody.quantity)
     *                  − sum(ongoing/overdue BookingAsset.quantity)
     *   max            = max(currentInThisKit, spaceWithoutMe)
     *
     * `operator-only` filters by `kitCustodyId IS NULL` — kit-allocated
     * Custody rows mirror the source kit's AssetKit slice and would
     * otherwise double-count against the multi-kit + in-custody case.
     *
     * `max(current, spaceWithoutMe)` lets the user keep their existing
     * slice in the overcommitted edge case (operator / booking growth
     * pushed the pool below the kit's current allocation).
     */
    const oversubscribed: Array<{
      assetId: string;
      title: string;
      submitted: number;
      max: number;
    }> = [];
    for (const asset of allAssetsForKit) {
      if (asset.type !== AssetType.QUANTITY_TRACKED) continue;
      const submitted = assetQuantities[asset.id];
      if (submitted == null) continue;

      const totalQty = asset.quantity ?? 0;
      const currentInThisKit =
        asset.assetKits.find((ak) => ak.kitId === kit.id)?.quantity ?? 0;
      const otherKitsQty = asset.assetKits
        .filter((ak) => ak.kitId !== kit.id)
        .reduce((sum, ak) => sum + (ak.quantity ?? 0), 0);
      const operatorOnlyCustody = (asset.custody ?? [])
        .filter((c) => c.kitCustodyId == null)
        .reduce((sum, c) => sum + (c.quantity ?? 0), 0);
      const ongoingBookings = (asset.bookingAssets ?? []).reduce(
        (sum, ba) => sum + (ba.quantity ?? 0),
        0
      );

      const spaceWithoutMe = Math.max(
        0,
        totalQty - otherKitsQty - operatorOnlyCustody - ongoingBookings
      );
      const max = Math.max(currentInThisKit, spaceWithoutMe);

      if (submitted > max) {
        oversubscribed.push({
          assetId: asset.id,
          title: asset.title,
          submitted,
          max,
        });
      }
    }
    if (oversubscribed.length > 0) {
      const detail = oversubscribed
        .map((o) => `${o.title} (requested ${o.submitted}, max ${o.max})`)
        .join("; ");
      throw new ShelfError({
        cause: null,
        title: "Quantity exceeds available pool",
        message: `Submitted quantity exceeds the strict-available pool for: ${detail}.`,
        additionalData: {
          kitId,
          userId,
          organizationId,
          oversubscribed,
        },
        label: "Kit",
        status: 400,
        shouldBeCaptured: false,
      });
    }

    /**
     * An INDIVIDUAL asset already in custody cannot be added to a kit.
     * QUANTITY_TRACKED assets are exempt: their `custody` array can carry
     * operator-allocated rows for *some* units while the rest of the pool
     * is free. Option B math in `buildKitCustodyInheritData` allocates
     * only the remaining pool when the kit is later put in custody, and
     * silently skips fully-allocated assets. Mirrors the client-side
     * picker exemption + the kit-custody assign-button exemption.
     */
    const isSomeAssetInCustody = newlyAddedAssets.some(
      (asset) =>
        asset.type !== AssetType.QUANTITY_TRACKED &&
        hasCustody(asset.custody) &&
        asset.assetKits[0]?.kitId !== kit.id
    );
    if (isSomeAssetInCustody) {
      throw new ShelfError({
        cause: null,
        message:
          "Cannot add assets that are already in custody to a kit. Please release custody of assets to allow them to be added to a kit.",
        additionalData: { userId, kitId },
        label: "Kit",
        shouldBeCaptured: false,
      });
    }

    const kitBookings =
      kit.assets
        .find((a) => a.bookingAssets.length > 0)
        ?.bookingAssets.map((ba) => ba.booking) ?? [];

    // The old kit.update({ data: { assets: { connect, disconnect } } })
    // block becomes direct pivot writes inside a single $transaction so
    // remove + add + qty-edit are atomic.
    // Collect AssetKit ids being deleted across both disconnect branches
    // so we can pre-fetch the kit-driven BookingAsset rows that will be
    // SET-NULL'd before the delete fires. The corresponding
    // `emitAssetKitDetachmentNotes` call runs at the end of the tx body
    // so bookings get a system note explaining the
    // conversion-to-standalone for their kit-driven slices.
    let detachmentImpact: Awaited<
      ReturnType<typeof fetchAssetKitDetachmentImpact>
    > = [];

    await db.$transaction(async (tx) => {
      // Disconnect: drop the pivot rows for removed assets (only when not
      // in addOnly mode).
      if (!addOnly && removedAssets.length > 0) {
        const aksToDelete = await tx.assetKit.findMany({
          where: {
            kitId: kit.id,
            assetId: { in: removedAssets.map(({ id }) => id) },
          },
          select: { id: true },
        });
        const aksToDeleteIds = aksToDelete.map((ak: { id: string }) => ak.id);
        detachmentImpact = detachmentImpact.concat(
          await fetchAssetKitDetachmentImpact(tx, aksToDeleteIds)
        );
        await mergeStandaloneCollisionsForKitDetachment(tx, aksToDeleteIds);
        await tx.assetKit.deleteMany({
          where: {
            kitId: kit.id,
            assetId: { in: removedAssets.map(({ id }) => id) },
          },
        });
      }

      // Cross-kit move (INDIVIDUAL only): an INDIVIDUAL asset can only
      // belong to one kit at a time. If the user selects an INDIVIDUAL
      // asset that already lives in another kit, drop that pivot row
      // first so the createMany below succeeds (the
      // `enforce_individual_asset_single_kit` trigger would otherwise
      // reject the insert with check_violation).
      //
      // QUANTITY_TRACKED assets can co-exist in multiple kits — their
      // pivot rows in OTHER kits stay intact, and the picker will have
      // set this kit's quantity in `assetQuantities[id]`.
      const movedFromOtherKitIds = newlyAddedAssets
        .filter(
          (asset) =>
            asset.type === AssetType.INDIVIDUAL &&
            (asset.assetKits?.length ?? 0) > 0
        )
        .map((asset) => asset.id);
      if (movedFromOtherKitIds.length > 0) {
        // Same pre-fetch as above so cross-kit-move INDIVIDUALS get the
        // detachment notes for any active booking that held the asset
        // via the OTHER kit. (Edge case but worth covering.)
        const aksToDelete = await tx.assetKit.findMany({
          where: { assetId: { in: movedFromOtherKitIds } },
          select: { id: true },
        });
        const aksToDeleteIds = aksToDelete.map((ak: { id: string }) => ak.id);
        detachmentImpact = detachmentImpact.concat(
          await fetchAssetKitDetachmentImpact(tx, aksToDeleteIds)
        );
        await mergeStandaloneCollisionsForKitDetachment(tx, aksToDeleteIds);
        await tx.assetKit.deleteMany({
          where: { assetId: { in: movedFromOtherKitIds } },
        });
      }

      // Connect: create one pivot row per newly added asset. Quantity
      // comes from the submitted `assetQuantities` map for QTY_TRACKED;
      // INDIVIDUAL is always 1. Missing map entries (today's behaviour
      // before the picker UI ships in T5) default QTY_TRACKED to the
      // asset's full pool — matches the backfill so there's no
      // observable change until the picker is wired up.
      if (newlyAddedAssets.length > 0) {
        await tx.assetKit.createMany({
          data: newlyAddedAssets.map((asset) => ({
            assetId: asset.id,
            kitId: kit.id,
            organizationId,
            quantity: addedAssetKitQuantity(asset),
          })),
        });
      }

      // Update: existing-in-kit assets whose submitted quantity differs
      // from the current pivot value. Each row needs its own update
      // because Prisma's updateMany doesn't support per-row data.
      if (qtyChangedAssets.length > 0) {
        for (const change of qtyChangedAssets) {
          await tx.assetKit.update({
            where: {
              assetId_kitId: { assetId: change.id, kitId: kit.id },
            },
            data: { quantity: change.newQuantity },
          });
        }
      }

      // Kit membership does NOT touch `AssetLocation`. Per the orthogonal-
      // axes model documented in `docs/proposals/quantitative-assets.md`
      // (lines 783-794), `AssetLocation` describes physical whereabouts and
      // `AssetKit` describes organisational grouping; they don't subtract
      // from each other. Adding an asset to a kit only writes the `AssetKit`
      // pivot — units stay at whichever location(s) they were already placed.
      // The asset's appearance on the kit's location-detail UI (when the kit
      // has a `locationId`) is derived from the join `AssetKit + Kit.locationId`,
      // not from a parallel kit-driven `AssetLocation` row.

      if (qtyChangedAssets.length > 0) {
        // Live link: every kit-driven BookingAsset row pointing at the
        // updated AssetKit gets its quantity synced. The reverse path
        // (BookingAsset → kit slice update) is *not* live; users edit
        // the booking through its own picker. This is one-way: the kit
        // is the source of truth for its slice.
        //
        // `BookingAsset` has no Prisma relation accessor on `assetKit`
        // (intentional — see the schema comment); resolve the AssetKit
        // id first, then update BookingAsset rows by `assetKitId`.
        const aksToSync = await tx.assetKit.findMany({
          where: {
            kitId: kit.id,
            assetId: { in: qtyChangedAssets.map((c) => c.id) },
          },
          select: { id: true, assetId: true, quantity: true },
        });
        const newQtyByAk = new Map(
          aksToSync.map((ak: { id: string; assetId: string }) => {
            const change = qtyChangedAssets.find((c) => c.id === ak.assetId);
            return [ak.id, change?.newQuantity ?? null] as const;
          })
        );

        // Check-in floor guard (Polish-7b): the kit's slice quantity is
        // the source of truth for its kit-driven BookingAsset rows, but it
        // must NOT be shrunk below units already checked in against that
        // exact slice. `ConsumptionLog` now carries `bookingAssetId`, so we
        // can sum per-row check-ins and refuse the shrink with a clear
        // error. (Legacy `bookingAssetId IS NULL` logs pre-date per-row
        // attribution and aren't counted here — same as the pre-guard
        // behaviour for those rows, so no regression.)
        const akIdsWithNewQty = [...newQtyByAk.entries()]
          .filter(([, q]) => q != null)
          .map(([id]) => id);
        if (akIdsWithNewQty.length > 0) {
          const drivenRows = await tx.bookingAsset.findMany({
            where: { assetKitId: { in: akIdsWithNewQty } },
            select: {
              id: true,
              assetKitId: true,
              asset: { select: { title: true } },
              booking: { select: { name: true } },
            },
          });
          if (drivenRows.length > 0) {
            const checkedInByRow = new Map<string, number>();
            const logSums = await tx.consumptionLog.groupBy({
              by: ["bookingAssetId"],
              where: {
                bookingAssetId: {
                  in: drivenRows.map((r: { id: string }) => r.id),
                },
                // The four check-in disposition categories — units that
                // have flowed back against this slice.
                category: { in: ["RETURN", "CONSUME", "LOSS", "DAMAGE"] },
              },
              _sum: { quantity: true },
            });
            for (const g of logSums as Array<{
              bookingAssetId: string | null;
              _sum: { quantity: number | null };
            }>) {
              if (g.bookingAssetId) {
                checkedInByRow.set(g.bookingAssetId, g._sum.quantity ?? 0);
              }
            }
            const violations = drivenRows.flatMap(
              (row: {
                id: string;
                assetKitId: string | null;
                asset: { title: string };
                booking: { name: string };
              }) => {
                const newQty = row.assetKitId
                  ? newQtyByAk.get(row.assetKitId)
                  : null;
                const checkedIn = checkedInByRow.get(row.id) ?? 0;
                return newQty != null && newQty < checkedIn
                  ? [
                      `"${row.asset.title}" on booking "${row.booking.name}" (${checkedIn} already checked in)`,
                    ]
                  : [];
              }
            );
            if (violations.length > 0) {
              throw new ShelfError({
                cause: null,
                status: 400,
                label,
                message: `Cannot reduce kit quantity below units already checked in: ${violations.join(
                  "; "
                )}. Check in fewer units or choose a higher quantity.`,
                shouldBeCaptured: false,
              });
            }
          }
        }

        for (const [akId, newQty] of newQtyByAk) {
          if (newQty == null) continue;
          await tx.bookingAsset.updateMany({
            where: { assetKitId: akId },
            data: { quantity: newQty },
          });
        }

        // No mirrored `AssetLocation` update — kit slice quantity lives on
        // `AssetKit` alone (and propagates to kit-driven `BookingAsset` rows
        // above). The `AssetLocation` axis is orthogonal and isn't touched
        // by kit-membership writes.
      }
    });

    // Notify each affected booking that its kit-driven BookingAsset
    // slice has been converted to standalone (via the DB-level
    // `SET NULL` cascade that ran inside the tx above). Outside the tx
    // so the notes only land if the cascade actually committed.
    await emitAssetKitDetachmentNotes({
      impact: detachmentImpact,
      actorUserId: userId,
      actorFirstName: user?.firstName ?? null,
      actorLastName: user?.lastName ?? null,
      organizationId,
    });

    // We synthesise the `{ kit }` field the note helper consumes from
    // each asset's current `assetKits` pivot rows.
    const newlyAddedAssetsForNotes = newlyAddedAssets.map((asset) => ({
      id: asset.id,
      title: asset.title,
      // Qty-tracked add note count. `quantity` is the per-row
      // AssetKit.quantity this asset will hold in THIS kit (same value the
      // pivot createMany wrote), not Asset.quantity.
      type: asset.type,
      unitOfMeasure: asset.unitOfMeasure,
      quantity: addedAssetKitQuantity(asset),
      kit: asset.assetKits[0]?.kitId
        ? // For freshly-attached assets we don't have the source kit's
          // name in scope; the note helper's `currentKit` path only
          // uses `id` + `name`, so fall back to "" for the latter — the
          // helper still renders a sane link.
          { id: asset.assetKits[0].kitId, name: "" }
        : null,
    }));
    const removedAssetsForNotes = (addOnly ? [] : removedAssets).map(
      (asset) => ({
        id: asset.id,
        title: asset.title,
        // Qty-tracked remove note count. `kitQuantity` is the per-row
        // AssetKit.quantity this asset held in THIS kit (captured at fetch
        // time, before the pivot row was deleted), not Asset.quantity.
        type: asset.type,
        unitOfMeasure: asset.unitOfMeasure,
        quantity: asset.kitQuantity,
        // Removed assets came from `kit.assets`, which itself was
        // flattened off `assetKits` for this kit — so the source kit
        // is the parent kit we're editing.
        kit: { id: kit.id, name: kit.name },
      })
    );

    await createBulkKitChangeNotes({
      kit,
      organizationId,
      newlyAddedAssets: newlyAddedAssetsForNotes,
      removedAssets: removedAssetsForNotes,
      userId,
    });

    // Activity events — one ASSET_KIT_CHANGED per asset added or removed.
    const kitChangeEvents: Parameters<typeof recordEvents>[0] = [
      ...newlyAddedAssets.map((asset) => ({
        organizationId,
        actorUserId: userId,
        action: "ASSET_KIT_CHANGED" as const,
        entityType: "ASSET" as const,
        entityId: asset.id,
        assetId: asset.id,
        kitId: kit.id,
        field: "kitId",
        // (the 1:1 FK). With the pivot, an asset already in another kit
        // has its kit-id in `assetKits[0].kitId`.
        fromValue: asset.assetKits[0]?.kitId ?? null,
        toValue: kit.id,
        // Qty-tracked: record the per-row AssetKit.quantity this asset now
        // holds in the kit (same value the pivot createMany wrote).
        meta: { ...assetQtyMeta(asset, addedAssetKitQuantity(asset)) },
      })),
      ...(addOnly ? [] : removedAssets).map((asset) => ({
        organizationId,
        actorUserId: userId,
        action: "ASSET_KIT_CHANGED" as const,
        entityType: "ASSET" as const,
        entityId: asset.id,
        assetId: asset.id,
        // The removal is still "about" this kit — populate the cross-ref so
        // "all activity for kit X" report queries see both adds and removes.
        kitId: kit.id,
        field: "kitId",
        fromValue: kit.id,
        toValue: null,
        // Qty-tracked: record the per-row AssetKit.quantity this asset held
        // in the kit before its pivot row was deleted.
        meta: { ...assetQtyMeta(asset, asset.kitQuantity) },
      })),
    ];
    if (kitChangeEvents.length > 0) {
      await recordEvents(kitChangeEvents);
    }

    /**
     * Post-tx side effects for the kit-driven AssetLocation rows
     * created above:
     *
     *   - Activity events (one `ASSET_LOCATION_CHANGED` per new kit-
     *     driven placement). `fromValue: null` — the kit-driven row is
     *     an ADDITION, not a replacement; manual placements survive
     *     untouched.
     *   - System notes describing the kit-driven placement.
     *
     * Only runs when `kit.location` is set. With no kit location, no
     * kit-driven row exists, so no event / note is needed — and
     * crucially, the user's manual placements are NOT touched.
     */
    if (kit.location && newlyAddedAssets.length > 0) {
      const kitLocationId = kit.location.id;
      await recordEvents(
        newlyAddedAssets.map((asset) => ({
          organizationId,
          actorUserId: userId,
          action: "ASSET_LOCATION_CHANGED" as const,
          entityType: "ASSET" as const,
          entityId: asset.id,
          assetId: asset.id,
          kitId: kit.id,
          locationId: kitLocationId,
          field: "locationId",
          fromValue: null,
          toValue: kitLocationId,
          // `meta.quantity` (qty-tracked only) = the per-row
          // `AssetKit.quantity` written into the new kit-driven location row
          // (matches the value passed to `assetLocation.createMany` above).
          meta: {
            viaKit: true,
            ...assetQtyMeta(asset, addedAssetKitQuantity(asset)),
          },
        }))
      );

      // Create notes describing the new kit-driven placement. The
      // existing helper renders as "moved to {kit.location}"; with
      // `currentLocation: null` it reads as a fresh placement.
      const noteUser = await getUserByID(userId, {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          displayName: true,
        } satisfies Prisma.UserSelect,
      });
      await Promise.all(
        newlyAddedAssets.map((asset) =>
          createNote({
            content: getKitLocationUpdateNoteContent({
              currentLocation: null,
              newLocation: kit.location,
              userId,
              firstName: noteUser?.firstName ?? "",
              lastName: noteUser?.lastName ?? "",
              isRemoving: false,
              // Qty-tracked cascade names the kit's per-row slice this
              // asset now holds in the kit (= the value written to the
              // kit-driven AssetLocation row).
              type: asset.type,
              unitOfMeasure: asset.unitOfMeasure,
              quantity: addedAssetKitQuantity(asset),
            }),
            type: "UPDATE",
            userId,
            assetId: asset.id,
            // why: asset resolved scoped to organizationId for this kit —
            // pass the org so the note is validated against the asset's
            // true org.
            organizationId,
          })
        )
      );
    }

    /**
     * If a kit is in custody then the assets added to kit will also inherit the status
     */
    const assetsToInheritStatus = newlyAddedAssets.filter(
      (asset) => !hasCustody(asset.custody)
    );

    if (
      kit.custody &&
      kit.custody.id &&
      kit.custody.custodian.id &&
      assetsToInheritStatus.length > 0
    ) {
      // Uses `buildKitCustodyInheritData` below to write child Custody
      // rows with `kitCustodyId` set and the *remaining* tracked
      // quantity per asset. A regressed shape that does per-asset
      // `Asset.update` with default `quantity: 1` and no `kitCustodyId`
      // would orphan operator-assigned custody on qty-tracked assets
      // and break the partial-custody invariants. The CUSTODY_ASSIGNED
      // events are emitted further below alongside the inheritData.
      const kitCustodyId = kit.custody.id;
      const teamMemberId = kit.custody.custodian.id;

      // Build child Custody rows tagged with `kitCustodyId` and threaded with
      // the asset's *remaining* tracked quantity (qty-tracked) or 1
      // (individual). The helper subtracts already-allocated custody so the
      // kit-allocated row never over-allocates the asset's pool. See
      // `buildKitCustodyInheritData`. Must run inside the tx — its read of
      // existing custody must see rows written earlier in this tx.
      // Returns the inherited Custody rows ({ assetId, quantity }) so the
      // post-tx note can name the per-asset unit count without re-reading.
      const inheritedRows = await db.$transaction(async (tx) => {
        const inheritData = await buildKitCustodyInheritData({
          tx,
          kitId: kit.id,
          kitCustodyId,
          teamMemberId,
          assetIds: assetsToInheritStatus.map((a) => a.id),
        });

        if (inheritData.length === 0) return [];

        await tx.custody.createMany({ data: inheritData });

        const inheritedIds = inheritData.map((row) => row.assetId);
        await tx.asset.updateMany({
          where: { id: { in: inheritedIds }, organizationId },
          data: { status: AssetStatus.IN_CUSTODY },
        });

        // Activity events — one CUSTODY_ASSIGNED per asset that inherited
        // custody. `meta.quantity` is the per-row count `buildKitCustodyInheritData`
        // already computed (the asset's real slice for qty-tracked, 1 for
        // INDIVIDUAL), so the event meta is left exactly as before.
        await recordEvents(
          inheritData.map((row) => ({
            organizationId,
            actorUserId: userId,
            action: "CUSTODY_ASSIGNED" as const,
            entityType: "ASSET" as const,
            entityId: row.assetId,
            assetId: row.assetId,
            kitId: kit.id,
            teamMemberId,
            targetUserId: kit.custody?.custodian?.user?.id ?? undefined,
            meta: { viaKit: true, quantity: row.quantity },
          })),
          tx
        );
        return inheritData.map((row) => ({
          assetId: row.assetId,
          quantity: row.quantity,
        }));
      });

      // Create notes only for assets that actually received an inherited
      // custody row. Fully operator-allocated qty-tracked assets are skipped
      // (no kit-custody row → no "granted custody" note for that asset).
      if (inheritedRows.length > 0) {
        const custodianDisplay = kitCustodianDisplay ?? "**Unknown Custodian**";
        // Asset shape (type / unitOfMeasure) keyed by id, for the unit count.
        const assetById = new Map(allAssetsForKit.map((a) => [a.id, a]));
        // One note per inheriting asset: qty-tracked assets name the granted
        // units ("custody of 50 units"); INDIVIDUAL phrasing stays unchanged.
        // why: assets resolved scoped to organizationId for this kit, so the
        // note writes target same-tenant assets only.
        const grantNoteData = inheritedRows.map((row) => {
          const asset = assetById.get(row.assetId);
          const count = asset ? formatUnitCount(asset, row.quantity) : null;
          const custodyPhrase = count ? `custody of ${count}` : "custody";
          return {
            content: `${actor} granted ${custodianDisplay} ${custodyPhrase}.`,
            type: NoteType.UPDATE,
            userId,
            assetId: row.assetId,
          };
        });
        await db.note.createMany({ data: grantNoteData });
      }
    }

    /**
     * In-custody kit qty-edit cascade.
     *
     * When the user changes a QUANTITY_TRACKED asset's quantity inside a
     * kit that's currently in custody, the kit-allocated `Custody.quantity`
     * needs to track the new `AssetKit.quantity`. Otherwise the custodian's
     * apparent allocation drifts out of sync with the kit's composition.
     *
     * For each qty-changed asset:
     * - Look up the kit-allocated Custody row (`kitCustodyId =
     *   kit.custody.id`).
     * - Update its quantity to match.
     * - Emit `CUSTODY_ASSIGNED` (increase) or `CUSTODY_RELEASED` (decrease)
     *   with `meta: { viaKit: true, quantity: <delta> }` so reports see
     *   the size of the change.
     *
     * If no kit-allocated Custody row exists (e.g. asset was fully
     * operator-allocated when the kit got custody, so `buildKitCustodyInheritData`
     * skipped it), we don't create one here — the qty-change alone
     * doesn't grant new custody. Picker UX should explain this case to
     * the user when it arises.
     */
    if (
      kit.custody &&
      kit.custody.id &&
      kit.custody.custodian.id &&
      qtyChangedAssets.length > 0
    ) {
      const kitCustodyId = kit.custody.id;
      const targetUserId = kit.custody.custodian.user?.id ?? undefined;
      const teamMemberId = kit.custody.custodian.id;

      await db.$transaction(async (tx) => {
        // Pre-fetch existing kit-allocated rows so we know which assets
        // actually have something to cascade (and what the previous
        // quantity was, in case it's drifted from `currentPivot.quantity`).
        const existingRows = await tx.custody.findMany({
          where: {
            assetId: { in: qtyChangedAssets.map((c) => c.id) },
            kitCustodyId,
          },
          select: { id: true, assetId: true, quantity: true },
        });
        const existingByAssetId = new Map(
          existingRows.map((r) => [r.assetId, r])
        );

        const events: Parameters<typeof recordEvents>[0] = [];
        for (const change of qtyChangedAssets) {
          const existing = existingByAssetId.get(change.id);
          if (!existing) continue;

          const delta = change.newQuantity - existing.quantity;
          if (delta === 0) continue;

          await tx.custody.update({
            where: { id: existing.id },
            data: { quantity: change.newQuantity },
          });

          events.push({
            organizationId,
            actorUserId: userId,
            action: delta > 0 ? "CUSTODY_ASSIGNED" : "CUSTODY_RELEASED",
            entityType: "ASSET" as const,
            entityId: change.id,
            assetId: change.id,
            kitId: kit.id,
            teamMemberId,
            targetUserId,
            meta: { viaKit: true, quantity: Math.abs(delta) },
          });
        }

        if (events.length > 0) {
          await recordEvents(events, tx);
        }
      });
    }

    /**
     * If a kit is in custody and some assets are removed,
     * then we have to make the removed assets Available
     * Only apply this when not in addOnly mode
     */
    if (
      !addOnly &&
      removedAssets.length &&
      kit.custody?.id &&
      kit.custody.custodian.id
    ) {
      const custodianDisplay = kitCustodianDisplay ?? "**Unknown Custodian**";
      const assetIds = removedAssets.map((a) => a.id);
      // Filter the kit-custody delete by `kitCustodyId` so only the
      // kit-allocated rows are removed; operator-assigned per-unit
      // custody on the same asset stays. Emitting events keyed only
      // on the kit's primary custodian id would mis-attribute
      // multi-custodian qty-tracked rows.
      const kitCustodyId = kit.custody.id;

      // Asset shape (type / unitOfMeasure) keyed by id, for the unit count.
      const assetById = new Map(removedAssets.map((a) => [a.id, a]));
      // Per-asset released units, populated inside the tx from the kit-
      // allocated Custody rows; consumed by the post-tx note. Assets with no
      // kit-custody row stay absent → no count → unchanged "custody" wording.
      const releasedQtyByAssetId = new Map<string, number | null>();

      // Use transaction for atomicity - prevents orphaned custody records.
      // Filter the deleteMany by `kitCustodyId` so only kit-allocated rows
      // are removed. Operator-assigned per-unit custody on the same asset
      // (`kitCustodyId IS NULL`) stays — that's separate ownership.
      await db.$transaction(async (tx) => {
        // Capture the kit-allocated rows before deletion to emit events.
        const removedKitCustodyRows = await tx.custody.findMany({
          where: { assetId: { in: assetIds }, kitCustodyId },
          // quantity → qty-tracked unit count in the event meta + note.
          select: { assetId: true, teamMemberId: true, quantity: true },
        });

        if (removedKitCustodyRows.length > 0) {
          for (const row of removedKitCustodyRows) {
            releasedQtyByAssetId.set(row.assetId, row.quantity);
          }
          await recordEvents(
            removedKitCustodyRows.map((row) => {
              const asset = assetById.get(row.assetId);
              return {
                organizationId,
                actorUserId: userId,
                action: "CUSTODY_RELEASED" as const,
                entityType: "ASSET" as const,
                entityId: row.assetId,
                assetId: row.assetId,
                kitId: kit.id,
                teamMemberId: row.teamMemberId,
                targetUserId: kit.custody?.custodian?.user?.id ?? undefined,
                meta: {
                  viaKit: true,
                  ...(asset ? assetQtyMeta(asset, row.quantity) : {}),
                },
              };
            }),
            tx
          );
        }

        await tx.custody.deleteMany({
          where: { assetId: { in: assetIds }, kitCustodyId },
        });

        // Only flip the asset to AVAILABLE when no remaining Custody
        // rows exist after deleting the kit-allocated ones (operator-
        // assigned per-unit custody keeps it IN_CUSTODY). CUSTODY_RELEASED
        // events are already emitted above keyed on each Custody row's
        // `teamMemberId`, so a post-delete blanket emission keyed only
        // on the kit's primary custodian would mis-attribute multi-
        // custodian rows.
        const stillCustodied = await tx.custody.findMany({
          where: { assetId: { in: assetIds } },
          select: { assetId: true },
        });
        const stillCustodiedIds = new Set(stillCustodied.map((c) => c.assetId));
        const assetsToFlipAvailable = assetIds.filter(
          (id) => !stillCustodiedIds.has(id)
        );
        if (assetsToFlipAvailable.length > 0) {
          await tx.asset.updateMany({
            where: { id: { in: assetsToFlipAvailable }, organizationId },
            data: { status: AssetStatus.AVAILABLE },
          });
        }
      });

      // Notes can be created outside transaction (not critical for consistency).
      // One note per removed asset: qty-tracked assets that had kit custody
      // name the released units ("custody of 50 units"); assets without a
      // kit-custody row (and all INDIVIDUAL assets) keep the prior wording.
      // why: assetIds derived from this kit's org-scoped assets — same-tenant
      // by construction.
      const releaseNoteData = removedAssets.map((asset) => {
        const count = formatUnitCount(
          asset,
          releasedQtyByAssetId.get(asset.id)
        );
        const custodyPhrase = count ? `custody of ${count}` : "custody";
        return {
          content: `${actor} released ${custodianDisplay}'s ${custodyPhrase}.`,
          type: NoteType.UPDATE,
          userId,
          assetId: asset.id,
        };
      });
      if (releaseNoteData.length > 0) {
        await db.note.createMany({ data: releaseNoteData });
      }
    }

    /**
     * If user is adding/removing an asset to a kit which is a part of DRAFT, RESERVED, ONGOING or OVERDUE booking,
     * then we have to add or remove these assets to booking also
     */
    const bookingsToUpdate = kitBookings.filter(
      (b) =>
        b.status === "DRAFT" ||
        b.status === "RESERVED" ||
        b.status === "ONGOING" ||
        b.status === "OVERDUE"
    );

    if (bookingsToUpdate?.length) {
      // When the kit picks up a new asset and the kit is already part of
      // a draft/active booking, the booking carries the kit as a unit —
      // so the new asset must be added to that booking as a kit-driven
      // row. Resolve the AssetKit ids the picker just created so we can
      // populate `assetKitId` (groups the row under the kit in the
      // booking UI) and `quantity` (inherits the kit's slice qty rather
      // than defaulting to 1, which would silently mis-count
      // QUANTITY_TRACKED assets in the booking).
      const newAssetIds = newlyAddedAssets.map((a) => a.id);
      const newAssetKits =
        newAssetIds.length > 0
          ? await db.assetKit.findMany({
              where: { kitId: kit.id, assetId: { in: newAssetIds } },
              select: { id: true, assetId: true, quantity: true },
            })
          : [];
      const akByAssetId = new Map(newAssetKits.map((ak) => [ak.assetId, ak]));

      await Promise.all(
        bookingsToUpdate.flatMap((booking) => {
          const ops = [];
          if (newlyAddedAssets.length > 0) {
            ops.push(
              db.bookingAsset.createMany({
                data: newlyAddedAssets.map((a) => {
                  const ak = akByAssetId.get(a.id);
                  return {
                    bookingId: booking.id,
                    assetId: a.id,
                    quantity: ak?.quantity ?? 1,
                    assetKitId: ak?.id ?? null,
                  };
                }),
                skipDuplicates: true,
              })
            );
          }
          // why: removing an asset from a kit no longer deletes its
          // BookingAsset rows from active bookings. The DB-level
          // `BookingAsset.assetKitId` FK fires `ON DELETE SET NULL` when
          // the AssetKit row is dropped (the actual delete happens in
          // the outer tx above), converting the kit-driven booking slice
          // into a standalone reservation. A per-booking system note
          // emitted by `emitAssetKitDetachmentNotes` explains the
          // conversion to the user. Deleting the row here would undo
          // the SET NULL and silently shrink the booking — the opposite
          // of the documented behaviour.
          //
          // Asset-bulk-remove (asset-side flow) is unaffected; it still
          // goes through `removeAssets` which deletes the rows explicitly.
          return ops;
        })
      );
    }

    /**
     * If the kit is part of an ONGOING booking, then we have to make all
     * the assets CHECKED_OUT
     */
    if (kit.status === KitStatus.CHECKED_OUT) {
      await db.asset.updateMany({
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: newlyAddedAssets derived from `allAssetsForKit` loaded org-scoped at the `where: { id: { in: assetIds }, organizationId }` query (line ~2442); not raw request input
        where: { id: { in: newlyAddedAssets.map((a) => a.id) } },
        data: { status: AssetStatus.CHECKED_OUT },
      });
    }

    return kit;
  } catch (cause) {
    const isShelfError = isLikeShelfError(cause);

    throw new ShelfError({
      cause,
      message: isShelfError
        ? cause.message
        : "Something went wrong while updating kit assets.",
      label,
      additionalData: { kitId, assetIds },
    });
  }
}

export async function bulkRemoveAssetsFromKits({
  assetIds,
  organizationId,
  userId,
  request,
  settings,
}: {
  assetIds: Asset["id"][];
  organizationId: Organization["id"];
  userId: User["id"];
  request: Request;
  settings: AssetIndexSettings;
}) {
  try {
    const user = await getUserByID(userId, {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        displayName: true,
      } satisfies Prisma.UserSelect,
    });
    const actor = wrapUserLinkForNote({
      id: userId,
      firstName: user?.firstName,
      lastName: user?.lastName,
    });

    // Resolve IDs (works for both simple and advanced mode)
    const searchParams = getCurrentSearchParams(request);
    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams: searchParams.toString(),
      settings,
    });

    // We pull the parent kit (today: ≤1 pivot row per asset) through
    // `assetKits.kit`, then flatten back into a synthetic `asset.kit`
    // shape so the rest of this function reads as it did pre-pivot.
    const assetRows = await db.asset.findMany({
      where: { id: { in: resolvedIds }, organizationId },
      select: {
        id: true,
        title: true,
        // type + unitOfMeasure label the qty-tracked unit count in the
        // custody-release note ("custody of 50 units").
        type: true,
        unitOfMeasure: true,
        assetKits: {
          select: {
            // This kit's per-row slice — surfaced in the cascade
            // ASSET_KIT_CHANGED event meta ("removed 50 units"). This is
            // AssetKit.quantity, NOT Asset.quantity.
            quantity: true,
            kit: {
              select: {
                id: true,
                name: true,
                custody: { select: { id: true } },
              },
            },
          },
        },
        custody: {
          select: {
            id: true,
            teamMemberId: true,
            kitCustodyId: true,
            // quantity → qty-tracked unit count in the CUSTODY_RELEASED
            // event meta + the release note below.
            quantity: true,
            custodian: {
              select: {
                id: true,
                name: true,
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    displayName: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const assets = assetRows.map((asset) => ({
      ...asset,
      // Defensive `?.` — test fixtures from main's PR #2535 mock the legacy
      // `kit` directly and omit the `assetKits` array entirely; this avoids a
      // TypeError reading [0] of undefined for those rows.
      kit: asset.assetKits?.[0]?.kit ?? null,
      // Per-row AssetKit.quantity this asset held in the kit being detached
      // (NOT Asset.quantity) — drives the qty-tracked count in the cascade
      // ASSET_KIT_CHANGED event meta. `null` for the legacy-mock rows above.
      kitQuantity: asset.assetKits?.[0]?.quantity ?? null,
    }));

    // Collect AssetKit ids being deleted across the bulk removal
    // branches so the post-tx emitter can write per-booking notes for
    // kit-driven slices that get SET-NULL'd by the DB cascade. See
    // {@link fetchAssetKitDetachmentImpact}.
    let bulkDetachmentImpact: Awaited<
      ReturnType<typeof fetchAssetKitDetachmentImpact>
    > = [];

    await db.$transaction(async (tx) => {
      /**
       * If there are assets whose kits were in custody, then we have to remove
       * the custody FIRST to avoid orphaned custody records when status is set
       * to AVAILABLE.
       *
       * Important: only the Custody rows whose `kitCustodyId` matches the
       * asset's kit's KitCustody.id are kit-allocated. Operator-assigned
       * per-unit custody (`kitCustodyId IS NULL`, or pointing to a different
       * kit) must be left alone — that's separate ownership and not part of
       * this kit-removal.
       */
      const assetsWhoseKitsInCustody = assets.filter(
        (asset) => !!asset.kit?.custody && hasCustody(asset.custody)
      );

      /** Pairs of (asset, kit-allocated custody row) to delete */
      const kitAllocatedCustodyToDelete = assetsWhoseKitsInCustody.flatMap(
        (asset) => {
          const kitCustodyId = asset.kit?.custody?.id;
          if (!kitCustodyId) return [];
          return (asset.custody ?? [])
            .filter((c) => c.kitCustodyId === kitCustodyId)
            .map((c) => ({
              custodyId: c.id,
              assetId: asset.id,
              kitId: asset.kit?.id,
              teamMemberId: c.teamMemberId,
              targetUserId: c.custodian?.user?.id,
              // Units this row releases — drives the qty-tracked count.
              quantity: c.quantity,
            }));
        }
      );

      // Asset shape (type / unitOfMeasure) and released-quantity per asset,
      // keyed by id, for the qty-tracked unit count in the event + note.
      const assetById = new Map(assets.map((a) => [a.id, a]));
      const releasedQtyByAssetId = new Map(
        kitAllocatedCustodyToDelete.map((row) => [row.assetId, row.quantity])
      );

      if (kitAllocatedCustodyToDelete.length > 0) {
        // Emit CUSTODY_RELEASED events BEFORE deletion so they roll back
        // atomically with the mutation if anything fails.
        await recordEvents(
          kitAllocatedCustodyToDelete.map((row) => {
            const asset = assetById.get(row.assetId);
            return {
              organizationId,
              actorUserId: userId,
              action: "CUSTODY_RELEASED" as const,
              entityType: "ASSET" as const,
              entityId: row.assetId,
              assetId: row.assetId,
              kitId: row.kitId ?? undefined,
              teamMemberId: row.teamMemberId,
              targetUserId: row.targetUserId ?? undefined,
              meta: {
                viaKit: true,
                ...(asset ? assetQtyMeta(asset, row.quantity) : {}),
              },
            };
          }),
          tx
        );

        await tx.custody.deleteMany({
          where: {
            id: { in: kitAllocatedCustodyToDelete.map((r) => r.custodyId) },
          },
        });
      }

      /**
       * Removing assets from kits — AFTER custody is deleted. Only flip
       * status to AVAILABLE when no remaining custody exists for the asset
       * (operator-assigned per-unit custody keeps it IN_CUSTODY).
       */
      const allRemovedAssetIds = assets.map((a) => a.id);
      const stillCustodied = await tx.custody.findMany({
        where: { assetId: { in: allRemovedAssetIds } },
        select: { assetId: true },
      });
      const stillCustodiedIds = new Set(stillCustodied.map((c) => c.assetId));
      const assetsToFlipAvailable = allRemovedAssetIds.filter(
        (id) => !stillCustodiedIds.has(id)
      );

      // Pre-fetch the kit-driven BookingAsset rows that the AssetKit
      // delete will SET-NULL via the DB cascade. We capture ids + kit
      // metadata BEFORE the delete (otherwise the join would lose its
      // target) so the post-tx note emitter can craft per-booking
      // system notes referencing the kit by name.
      const aksToDelete = await tx.assetKit.findMany({
        where: {
          assetId: { in: allRemovedAssetIds },
          organizationId,
        },
        select: { id: true },
      });
      bulkDetachmentImpact = bulkDetachmentImpact.concat(
        await fetchAssetKitDetachmentImpact(
          tx,
          aksToDelete.map((ak: { id: string }) => ak.id)
        )
      );

      // Detach all from the kit regardless of remaining custody.
      // "detach from kit" means deleting the pivot rows for these
      // assets within this organization.
      await tx.assetKit.deleteMany({
        where: {
          assetId: { in: allRemovedAssetIds },
          organizationId,
        },
      });
      if (assetsToFlipAvailable.length > 0) {
        await tx.asset.updateMany({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `assetsToFlipAvailable` derive from `assets` loaded via the org-scoped `where: { id: { in: resolvedIds }, organizationId }` query earlier in bulkRemoveAssetsFromKits
          where: { id: { in: assetsToFlipAvailable } },
          data: { status: AssetStatus.AVAILABLE },
        });
      }

      /** Create notes for assets released from custody */
      if (assetsWhoseKitsInCustody.length > 0) {
        await tx.note.createMany({
          data: assetsWhoseKitsInCustody.map((asset) => {
            const primaryCustody = getPrimaryCustody(asset.custody);
            const custodianDisplay = primaryCustody?.custodian
              ? wrapCustodianForNote({
                  teamMember: primaryCustody.custodian,
                })
              : "**Unknown Custodian**";
            // qty-tracked assets name the units released ("custody of 50
            // units"); INDIVIDUAL phrasing is unchanged.
            const count = formatUnitCount(
              asset,
              releasedQtyByAssetId.get(asset.id)
            );
            const custodyPhrase = count ? `custody of ${count}` : "custody";
            return {
              content: `${actor} released ${custodianDisplay}'s ${custodyPhrase}.`,
              type: "UPDATE",
              userId,
              assetId: asset.id,
            };
          }),
        });
      }

      /** Create notes for assets removed from kit */
      const assetsRemovedFromKit = assets.filter((asset) => asset.kit);
      if (assetsRemovedFromKit.length > 0) {
        await tx.note.createMany({
          data: assetsRemovedFromKit.map((asset) => {
            const kitLink = wrapLinkForNote(
              `/kits/${asset.kit!.id}`,
              asset.kit!.name.trim()
            );
            // Qty-tracked: name the unit count being removed from this
            // kit ("removed 50 units from Camera Kit") using the per-row
            // AssetKit.quantity threaded as `kitQuantity` on the asset
            // shape above. INDIVIDUAL preserves the original countless
            // wording. Mirrors the singular path in
            // `createKitChangeNote` (note/service.server.ts).
            const count = formatUnitCount(asset, asset.kitQuantity);
            const content = count
              ? `${actor} removed ${count} from ${kitLink}.`
              : `${actor} removed asset from ${kitLink}.`;
            return {
              content,
              type: "UPDATE",
              userId,
              assetId: asset.id,
            };
          }),
        });
      }

      // Activity events — one ASSET_KIT_CHANGED per asset that left a kit.
      if (assetsRemovedFromKit.length > 0) {
        await recordEvents(
          assetsRemovedFromKit.map((asset) => ({
            organizationId,
            actorUserId: userId,
            action: "ASSET_KIT_CHANGED" as const,
            entityType: "ASSET" as const,
            entityId: asset.id,
            assetId: asset.id,
            kitId: asset.kit!.id,
            field: "kitId",
            fromValue: asset.kit!.id,
            toValue: null,
            // Qty-tracked: the per-row AssetKit.quantity this asset held in
            // the detached kit (NOT Asset.quantity); {} for INDIVIDUAL.
            meta: { ...assetQtyMeta(asset, asset.kitQuantity) },
          })),
          tx
        );
      }

      // Activity events — one CUSTODY_RELEASED per asset whose kit-inherited
      // custody was cleaned up. `meta.viaKit` mirrors the kit-custody flows
      // in `releaseCustody` / `bulkReleaseKitCustody`. Phase 2 turned Custody
      // from 1:1 into 1:N so `asset.custody` is an array now — read the
      // primary row via the helper.
      if (assetsWhoseKitsInCustody.length > 0) {
        await recordEvents(
          assetsWhoseKitsInCustody.map((asset) => {
            const primaryCustody = getPrimaryCustody(asset.custody);
            return {
              organizationId,
              actorUserId: userId,
              action: "CUSTODY_RELEASED" as const,
              entityType: "ASSET" as const,
              entityId: asset.id,
              assetId: asset.id,
              kitId: asset.kit?.id,
              teamMemberId: primaryCustody?.custodian?.id,
              targetUserId: primaryCustody?.custodian?.user?.id ?? undefined,
              meta: { viaKit: true },
            };
          }),
          tx
        );
      }
    });

    // Notify each affected booking that its kit-driven BookingAsset
    // slice has been converted to standalone.
    await emitAssetKitDetachmentNotes({
      impact: bulkDetachmentImpact,
      actorUserId: userId,
      actorFirstName: user?.firstName ?? null,
      actorLastName: user?.lastName ?? null,
      organizationId,
    });

    return true;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to bulk remove assets from kits",
      additionalData: { assetIds, organizationId, userId },
      label: "Kit",
    });
  }
}

/**
 * Move N units of a `QUANTITY_TRACKED` asset between two `AssetKit` pivot
 * rows in a single transaction.
 *
 * Symmetric to `moveAssetLocationUnits` (on the location axis) but with the
 * extra cascade and guard work the kit axis demands:
 *
 *   - Cascades the new dest-kit quantity to any **active** kit-driven
 *     `BookingAsset` rows on the destination kit (mirrors the existing
 *     `updateKitAssets` cascade pattern).
 *   - **Blocks** the move when the source kit has active booking slices
 *     (`DRAFT` / `RESERVED` / `ONGOING` / `OVERDUE`) — the user is told to
 *     release those bookings first rather than have us silently shrink the
 *     slices out from under an in-flight booking (decision 2026-06-10).
 *   - **Blocks** the move when the source kit is in operator custody
 *     (`KitCustody` → inherited `Custody` on this asset) — release custody
 *     first rather than orphan units.
 *
 * Emits two paired `ASSET_KIT_CHANGED` activity events (`meta.moveCorrelationId`
 * pairs them) and two paired Notes (`createKitMoveNote` — new phrasing
 * "moved {N units} from kit {KitX} to kit {KitY}").
 *
 * @param args - `MoveAssetKitUnitsArgs`: assetId, organizationId, userId,
 *   fromKitId, toKitId, quantity
 * @returns `MoveUnitsResult` — post-tx quantities + the deleted-source flag
 *   + the correlation id (so the action handler can surface a paired toast)
 * @throws {ShelfError} 400 when validation fails (qty <= 0, same source/dest,
 *   asset is INDIVIDUAL, asset not allocated to source kit, qty exceeds
 *   source allocation, active bookings on source, active custody on source)
 * @throws {ShelfError} 403 implicitly via `assertAssetsBelongToOrg` on a
 *   cross-org IDOR attempt
 */
export async function moveAssetKitUnits(
  args: MoveAssetKitUnitsArgs
): Promise<MoveUnitsResult> {
  const { assetId, organizationId, userId, fromKitId, toKitId, quantity } =
    args;

  // Cheap pre-tx guards — keeps the tx body focused on row work.
  if (quantity <= 0) {
    throw new ShelfError({
      cause: null,
      message: "Quantity must be greater than zero.",
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { assetId, quantity },
    });
  }

  if (fromKitId === toKitId) {
    throw new ShelfError({
      cause: null,
      message: "Source and destination kits must be different.",
      label,
      status: 400,
      shouldBeCaptured: false,
      additionalData: { assetId, fromKitId, toKitId },
    });
  }

  try {
    const txResult = await db.$transaction(async (tx) => {
      // 1. Org-scope guards — every ID came from form input, prove it
      //    belongs to the caller's org before any read/write touches it.
      //    Per `.claude/rules/org-scope-user-supplied-ids.md`.
      await assertAssetsBelongToOrg(
        { assetIds: [assetId], organizationId },
        tx
      );

      const [fromKit, toKit] = await Promise.all([
        tx.kit.findFirst({
          where: { id: fromKitId, organizationId },
          select: { id: true, name: true },
        }),
        tx.kit.findFirst({
          where: { id: toKitId, organizationId },
          select: { id: true, name: true },
        }),
      ]);

      if (!fromKit) {
        throw new ShelfError({
          cause: null,
          message:
            "The source kit could not be found in your workspace. Please reload and try again.",
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { organizationId, fromKitId },
        });
      }
      if (!toKit) {
        throw new ShelfError({
          cause: null,
          message:
            "The destination kit could not be found in your workspace. Please reload and try again.",
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { organizationId, toKitId },
        });
      }

      // 2. Lock the asset row for the duration of the tx — serializes
      //    concurrent moves on the same asset (Phase 2 pattern).
      const asset = await lockAssetForQuantityUpdate(tx, assetId);

      // Defence-in-depth: lock helper doesn't org-scope; assert again.
      if (asset.organizationId !== organizationId) {
        throw new ShelfError({
          cause: null,
          message: "Asset does not belong to this organization.",
          label,
          status: 403,
          additionalData: { assetId, organizationId },
        });
      }

      // 3. Refuse for INDIVIDUAL — split/merge is qty-tracked-only.
      if (asset.type !== AssetType.QUANTITY_TRACKED) {
        throw new ShelfError({
          cause: null,
          message: "Split/merge is only available for quantity-tracked assets.",
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { assetId, assetType: asset.type },
        });
      }

      // 4. Load source AssetKit pivot row — the source of truth for what
      //    "currently allocated" means.
      const source = await tx.assetKit.findFirst({
        where: { assetId, kitId: fromKitId },
        select: { id: true, quantity: true },
      });
      if (!source) {
        throw new ShelfError({
          cause: null,
          message: "Asset is not allocated to the source kit.",
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { assetId, fromKitId },
        });
      }

      // 5. Refuse over-move — we can't move more than the source has.
      const unitLabel = (asset.unitOfMeasure ?? "").trim() || "units";
      if (quantity > source.quantity) {
        throw new ShelfError({
          cause: null,
          message: `Only ${source.quantity} ${unitLabel} allocated to ${fromKit.name}.`,
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: {
            assetId,
            fromKitId,
            requested: quantity,
            available: source.quantity,
          },
        });
      }

      // 6. Active-booking block (decision 2026-06-10). Shrinking the
      //    source kit's allocation would silently shrink any kit-driven
      //    BookingAsset slice on an active booking out from under the
      //    user. Block with a helpful error instead.
      const activeBookingSlices = await tx.bookingAsset.findMany({
        where: {
          assetId,
          assetKitId: source.id,
          booking: {
            status: {
              in: [
                BookingStatus.DRAFT,
                BookingStatus.RESERVED,
                BookingStatus.ONGOING,
                BookingStatus.OVERDUE,
              ],
            },
          },
        },
        select: {
          bookingId: true,
          quantity: true,
          booking: { select: { name: true, status: true } },
        },
      });

      if (activeBookingSlices.length > 0) {
        const activeBookingsCount = activeBookingSlices.length;
        const plural = activeBookingsCount === 1 ? "" : "s";
        const names = activeBookingSlices.map((s) => s.booking.name);
        const shown = names.slice(0, 3).join(", ");
        const overflow = names.length > 3 ? ", …" : "";
        throw new ShelfError({
          cause: null,
          message: `Cannot move — ${fromKit.name} is currently allocated to ${activeBookingsCount} active booking${plural}: ${shown}${overflow}. Release these bookings first.`,
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: {
            assetId,
            fromKitId,
            activeBookings: activeBookingSlices.map((s) => ({
              bookingId: s.bookingId,
              name: s.booking.name,
              status: s.booking.status,
              quantity: s.quantity,
            })),
          },
        });
      }

      // 7. Kit-inherited custody block. If the source kit is in operator
      //    custody, the asset has an inherited Custody row pointing at
      //    the source's KitCustody — moving units out from under that
      //    would orphan the custody bookkeeping. Block instead.
      const inheritedCustody = await tx.custody.findFirst({
        where: { assetId, kitCustody: { kitId: fromKitId } },
        select: {
          id: true,
          kitCustody: {
            select: { custodian: { select: { name: true } } },
          },
        },
      });
      if (inheritedCustody) {
        const custodianName =
          inheritedCustody.kitCustody?.custodian.name ?? "an operator";
        throw new ShelfError({
          cause: null,
          message: `Cannot move — ${fromKit.name} is currently in ${custodianName}'s custody. Release custody first.`,
          label,
          status: 400,
          shouldBeCaptured: false,
          additionalData: { assetId, fromKitId, custodianName },
        });
      }

      // 8. Decrement (or delete-on-zero) the source AssetKit row.
      const newSourceQty = source.quantity - quantity;
      const sourceRowDeleted = newSourceQty === 0;
      if (sourceRowDeleted) {
        // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: source.id came from the org+asset+kit-scoped findFirst above, inside this same tx
        await tx.assetKit.delete({ where: { id: source.id } });
      } else {
        await tx.assetKit.update({
          // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: source.id came from the org+asset+kit-scoped findFirst above, inside this same tx
          where: { id: source.id },
          data: { quantity: newSourceQty },
        });
      }

      // 9. Upsert destination AssetKit row on the (assetId, kitId)
      //    partial-unique. Bump if exists, create at N otherwise.
      const dest = await tx.assetKit.upsert({
        where: { assetId_kitId: { assetId, kitId: toKitId } },
        create: {
          assetId,
          kitId: toKitId,
          organizationId,
          quantity,
        },
        update: { quantity: { increment: quantity } },
        select: { id: true, quantity: true },
      });

      // 10. Cascade to active kit-driven BookingAsset rows on the DEST
      //     kit — keep them in sync with the new slice quantity (mirrors
      //     the `updateKitAssets` pattern at lines ~4127-4133). Only
      //     active bookings need the cascade; historical (COMPLETE /
      //     ARCHIVED / CANCELLED) slices are frozen records and stay
      //     untouched. Source-side cascade is unreachable here because
      //     step 6 already blocked when the source had active slices.
      await tx.bookingAsset.updateMany({
        where: {
          assetKitId: dest.id,
          booking: {
            status: {
              in: [
                BookingStatus.DRAFT,
                BookingStatus.RESERVED,
                BookingStatus.ONGOING,
                BookingStatus.OVERDUE,
              ],
            },
          },
        },
        data: { quantity: dest.quantity },
      });

      // 11. Paired ASSET_KIT_CHANGED events. `moveCorrelationId` lets
      //     reports rebuild the move from the two halves.
      const moveCorrelationId = crypto.randomUUID();
      await recordEvents(
        [
          {
            organizationId,
            actorUserId: userId,
            action: "ASSET_KIT_CHANGED" as const,
            entityType: "ASSET" as const,
            entityId: assetId,
            assetId,
            kitId: fromKitId,
            field: "kitId",
            fromValue: fromKitId,
            toValue: null,
            meta: {
              quantity,
              moveCorrelationId,
              side: "from" as const,
              fromKitId,
              toKitId,
            },
          },
          {
            organizationId,
            actorUserId: userId,
            action: "ASSET_KIT_CHANGED" as const,
            entityType: "ASSET" as const,
            entityId: assetId,
            assetId,
            kitId: toKitId,
            field: "kitId",
            fromValue: null,
            toValue: toKitId,
            meta: {
              quantity,
              moveCorrelationId,
              side: "to" as const,
              fromKitId,
              toKitId,
            },
          },
        ],
        tx
      );

      // Load the acting user once for the post-tx note write. Reads
      //     are part of the tx so a rolled-back move never produces a
      //     stale `firstName`/`lastName` for the note.
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });

      return {
        fromQuantity: sourceRowDeleted ? 0 : newSourceQty,
        toQuantity: dest.quantity,
        sourceRowDeleted,
        moveCorrelationId,
        // Carry forward the data the post-tx note writer needs so it
        // can land only if the tx actually committed.
        noteContext: {
          firstName: user?.firstName ?? "",
          lastName: user?.lastName ?? "",
          assetType: asset.type,
          unitOfMeasure: asset.unitOfMeasure,
          fromKit,
          toKit,
        },
      };
    });

    // 12. Paired notes (post-tx). Mirrors `createBulkKitChangeNotes` at
    //     line ~4200 — kit notes land outside the tx so a rolled-back
    //     move leaves the activity feed clean.
    await createKitMoveNote({
      fromKit: txResult.noteContext.fromKit,
      toKit: txResult.noteContext.toKit,
      firstName: txResult.noteContext.firstName,
      lastName: txResult.noteContext.lastName,
      assetId,
      userId,
      organizationId,
      type: txResult.noteContext.assetType,
      unitOfMeasure: txResult.noteContext.unitOfMeasure,
      quantity,
    });

    return {
      fromQuantity: txResult.fromQuantity,
      toQuantity: txResult.toQuantity,
      sourceRowDeleted: txResult.sourceRowDeleted,
      moveCorrelationId: txResult.moveCorrelationId,
    };
  } catch (cause) {
    // Pass through ShelfErrors with their context; wrap unknown causes.
    if (isLikeShelfError(cause)) {
      throw cause;
    }
    throw new ShelfError({
      cause,
      message: "Failed to move units between kits",
      additionalData: { assetId, fromKitId, toKitId, quantity, userId },
      label,
    });
  }
}
