import type {
  Asset,
  AuditSession,
  Category,
  Currency,
  Kit,
  Note,
  Prisma,
  Tag,
  User,
} from "@prisma/client";
import type { AssetType, ConsumptionType } from "@prisma/client";
import { db } from "~/database/db.server";
import {
  buildCategoryChangeNote,
  buildDescriptionChangeNote,
  buildNameChangeNote,
  buildValuationChangeNote,
  resolveUserLink,
} from "~/modules/note/helpers.server";
import type {
  BasicUserName,
  LoadUserForNotesFn,
} from "~/modules/note/load-user-for-notes.server";
export type { BasicUserName } from "~/modules/note/load-user-for-notes.server";
import { NOTE_TYPE_FILTER_MAP } from "~/modules/note/note-filters";
import {
  formatUnitCount,
  sanitizeUnitOfMeasureLabel,
} from "~/utils/asset-quantity";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import {
  wrapKitsWithDataForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
  wrapTagForNote,
} from "~/utils/markdoc-wrappers";
import {
  assertAssetsBelongToOrg,
  type OrgValidationTxClient,
} from "~/utils/org-validation.server";

const label = "Note";

/**
 * Minimal Prisma surface `createNotes` needs when run inside a transaction.
 * Extends {@link OrgValidationTxClient} (so the same `tx` can be forwarded to
 * `assertAssetsBelongToOrg`) with the `note.createMany` write. Typed
 * structurally because the extended transaction client is not directly
 * assignable to the generated `Prisma.TransactionClient` (same approach as
 * `RecordEventTxClient` / `OrgValidationTxClient`).
 */
export type NotesTxClient = OrgValidationTxClient & {
  note: {
    createMany: (args: {
      data: Prisma.NoteUncheckedCreateInput[];
    }) => Promise<{ count: number }>;
  };
};

export type TagSummary = Pick<Tag, "id" | "name">;

/**
 * Creates a singular note.
 *
 * `organizationId` is required and validated: the target asset must belong to
 * that organization before the note is written. This prevents cross-org IDOR
 * where a caller supplies an asset ID from another tenant.
 *
 * @param params.organizationId - Caller's validated organization ID
 * @throws {ShelfError} 400 if the asset is not in `organizationId`
 */
export async function createNote({
  content,
  type,
  userId,
  assetId,
  organizationId,
}: Pick<Note, "content"> & {
  type?: Note["type"];
  userId: User["id"];
  assetId: Asset["id"];
  organizationId: string;
}) {
  try {
    await assertAssetsBelongToOrg({ assetIds: [assetId], organizationId });

    const data = {
      content,
      type: type || "COMMENT",
      user: {
        connect: {
          id: userId,
        },
      },
      asset: {
        connect: {
          id: assetId,
        },
      },
    };

    return await db.note.create({
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating a note",
      additionalData: { type, userId, assetId },
      label,
    });
  }
}

/**
 * Creates multiple notes with the same content.
 *
 * `organizationId` is required and validated: every target asset must belong
 * to that organization before the notes are written (cross-org IDOR guard).
 *
 * @param params.organizationId - Caller's validated organization ID
 * @param tx - Optional Prisma transaction client. When the caller already runs
 *   inside a `db.$transaction`, pass it so the org guard and the note write
 *   commit atomically with the surrounding mutation (and roll back together).
 *   Defaults to the global `db`.
 * @throws {ShelfError} 400 if any asset is not in `organizationId`
 */
export async function createNotes(
  {
    content,
    type,
    userId,
    assetIds,
    organizationId,
  }: Pick<Note, "content"> & {
    type?: Note["type"];
    userId: User["id"];
    assetIds: Asset["id"][];
    organizationId: string;
  },
  tx?: NotesTxClient
) {
  try {
    const client = tx ?? db;

    await assertAssetsBelongToOrg({ assetIds, organizationId }, tx);

    const data = assetIds.map((id) => ({
      content,
      type: type || "COMMENT",
      userId,
      assetId: id,
    }));

    return await client.note.createMany({
      data,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating notes",
      additionalData: { type, userId, assetIds },
      label,
    });
  }
}

export async function deleteNote({
  id,
  userId,
}: Pick<Note, "id"> & { userId: User["id"] }) {
  try {
    return await db.note.deleteMany({
      where: { id, userId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while deleting the note",
      additionalData: { id, userId },
      label,
    });
  }
}

/**
 * Loads a single asset's notes (its activity log) with pagination, free-text
 * search, and a note-type filter — so the activity tab reuses the same list
 * mechanics (`<Filters>`, `<StatusFilter>`, `<Pagination>`) as the rest of the
 * app instead of rendering every note unbounded.
 *
 * Reads the standard list query params from the request:
 * - `page` / `per_page` — pagination ({@link getParamsValues} + {@link updateCookieWithPerPage})
 * - `s` — free-text search, matched against note content and the author's name
 * - `noteType` — "Comments" (human `COMMENT` notes) or "Updates" (system
 *   `UPDATE` notes); any other value (incl. absent / "ALL") returns both.
 *
 * The total count is resolved BEFORE the page is fetched so the requested
 * The requested `page` is clamped to the last populated page: an out-of-range
 * page (deleting the last note on a page, or a stale bookmarked `?page=N`)
 * returns that page instead of an empty list that reads as a false "No Notes"
 * empty state. The clamped value is what's returned as `page`. `totalPages`
 * itself follows the shared list contract (`0` when nothing matches).
 *
 * `organizationId` is required and scopes the query via `asset.organizationId`,
 * so a note can never be read across tenants even if a foreign `assetId` is
 * supplied (see `.claude/rules/org-scope-user-supplied-ids.md`).
 *
 * @returns Pagination metadata plus the page of notes (`items`, newest first),
 *   `hasNotes` (whether the asset has ANY notes ignoring the active filter — so
 *   the UI can keep the "Export activity CSV" action visible even when a filter
 *   matches zero notes), and the `cookie` for the loader to serialize as a
 *   `Set-Cookie` header (persists the per-page preference).
 * @throws {ShelfError} If the database query fails.
 */
export async function getPaginatedAndFilterableAssetNotes({
  assetId,
  organizationId,
  request,
}: {
  assetId: Asset["id"];
  organizationId: string;
  request: Request;
}) {
  const searchParams = getCurrentSearchParams(request);
  const { page, perPageParam, search } = getParamsValues(searchParams);

  const typeFilter = NOTE_TYPE_FILTER_MAP[searchParams.get("noteType") ?? ""];

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    /**
     * Normalize the page size once and use it for the query, the skip offset,
     * and the returned metadata so `perPage`/`totalPages` always describe the
     * page we actually fetched (200 is the established out-of-range fallback).
     */
    const safePerPage = perPage >= 1 && perPage <= 100 ? perPage : 200;

    /** Scope by the asset AND its organization (cross-tenant read guard) */
    const where: Prisma.NoteWhereInput = {
      assetId,
      asset: { organizationId },
    };

    if (typeFilter) {
      where.type = typeFilter;
    }

    if (search) {
      /**
       * Match the search term against the note body or the author's name.
       * `displayName` is included because the note card shows it (via
       * `resolveUserDisplayName`) for SSO users, so a search for the visible
       * author name must match it too.
       */
      where.OR = [
        { content: { contains: search, mode: "insensitive" } },
        {
          user: {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { displayName: { contains: search, mode: "insensitive" } },
            ],
          },
        },
      ];
    }

    // Count first so the requested page can be clamped into range before the
    // page is fetched (see JSDoc). `totalPages` follows the shared list contract
    // (`0` when nothing matches, like the other paginated services), so clamp
    // against a separate `lastPage` ceiling instead of inflating the metadata.
    const totalItems = await db.note.count({ where });
    const totalPages = Math.ceil(totalItems / safePerPage);
    // Clamp the requested page into [1, lastPage] so an out-of-range page
    // (e.g. deleting the last note on a page, or a stale bookmarked ?page=N)
    // still returns a populated page instead of an empty list.
    const lastPage = Math.max(1, totalPages);
    const currentPage = Math.min(Math.max(page, 1), lastPage);
    const skip = (currentPage - 1) * safePerPage;

    const notes = await db.note.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: safePerPage,
      include: {
        user: {
          select: { firstName: true, lastName: true, displayName: true },
        },
      },
    });

    /**
     * Whether the asset has ANY notes, ignoring the active filter — lets the UI
     * keep the "Export activity CSV" action visible when a filter matches zero
     * notes (an empty filtered view is not an empty activity log). Only pay for
     * the extra unfiltered count when a filter is active; otherwise `totalItems`
     * already is the unfiltered total.
     */
    const hasActiveFilter = Boolean(typeFilter || search);
    const hasNotes = hasActiveFilter
      ? (await db.note.count({
          where: { assetId, asset: { organizationId } },
        })) > 0
      : totalItems > 0;

    return {
      page: currentPage,
      perPage: safePerPage,
      search,
      items: notes,
      totalItems,
      totalPages,
      hasNotes,
      cookie,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while fetching the asset's notes",
      additionalData: { assetId, organizationId },
      label,
    });
  }
}

/**
 * Per-asset note shape used by `createBulkKitChangeNotes`.
 *
 * Kit membership lives on the `AssetKit` pivot rather than a direct
 * 1:1 relation, so callers flatten the pivot themselves and attach a
 * `kit: { id, name } | null` synthetic field per row. This helper only
 * needs the minimal fields it reads from that shape.
 *
 * `type` + `unitOfMeasure` + `quantity` drive the qty-tracked unit count
 * in the add/remove note ("added 50 units to Camera Kit"). `quantity` is
 * the per-row `AssetKit.quantity` for THIS kit (the slice held in the kit
 * being changed), NOT `Asset.quantity` — the caller supplies it.
 */
type AssetForKitChangeNote = {
  id: Asset["id"];
  title: Asset["title"];
  type: AssetType;
  unitOfMeasure?: string | null;
  /** The asset's `AssetKit.quantity` for the kit being changed. */
  quantity?: number | null;
  kit: Pick<Kit, "id" | "name"> | null;
};

export async function createBulkKitChangeNotes({
  newlyAddedAssets,
  removedAssets,
  userId,
  kit,
  organizationId,
}: {
  newlyAddedAssets: AssetForKitChangeNote[];
  removedAssets: AssetForKitChangeNote[];
  userId: User["id"];
  kit: Kit;
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
}) {
  try {
    const user = await db.user
      .findFirstOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true, displayName: true },
      })
      .catch((cause) => {
        throw new ShelfError({
          cause,
          message: "User not found",
          additionalData: { userId },
          label,
        });
      });

    for (const asset of [...newlyAddedAssets, ...removedAssets]) {
      const isAssetRemoved = removedAssets.some((a) => a.id === asset.id);
      const isNewlyAdded = newlyAddedAssets.some((a) => a.id === asset.id);
      const newKit = isAssetRemoved ? null : kit;
      const currentKit = asset.kit ? asset.kit : null;

      if (isNewlyAdded || isAssetRemoved) {
        await createKitChangeNote({
          currentKit,
          newKit,
          firstName: user.firstName ?? "",
          lastName: user.lastName ?? "",
          assetId: asset.id,
          userId,
          organizationId,
          isRemoving: isAssetRemoved,
          // Qty-tracked unit count for the add/remove phrasing. `quantity`
          // is this asset's per-row AssetKit.quantity for the kit being
          // changed (supplied by the caller), not Asset.quantity.
          type: asset.type,
          unitOfMeasure: asset.unitOfMeasure,
          quantity: asset.quantity,
        });
      }
    }
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while creating bulk kit change notes",
      additionalData: {
        userId,
        newlyAddedAssetsIds: newlyAddedAssets.map((a) => a.id),
        removedAssetsIds: removedAssets.map((a) => a.id),
      },
      label,
    });
  }
}

export async function createKitChangeNote({
  currentKit,
  newKit,
  firstName,
  lastName,
  assetId,
  userId,
  organizationId,
  isRemoving,
  type,
  unitOfMeasure,
  quantity,
}: {
  currentKit: Pick<Kit, "id" | "name"> | null;
  newKit: Pick<Kit, "id" | "name"> | null;
  firstName: string;
  lastName: string;
  assetId: Asset["id"];
  userId: User["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  isRemoving: boolean;
  /** Asset type — decides whether a qty-tracked unit count applies. */
  type: AssetType;
  /** Labels the count ("units" / "boxes"); defaults to "units". */
  unitOfMeasure?: string | null;
  /**
   * Per-row `AssetKit.quantity` for the kit being changed (NOT
   * `Asset.quantity`). Surfaced in the add/remove phrasing for
   * QUANTITY_TRACKED assets; ignored for INDIVIDUAL.
   */
  quantity?: number | null;
}) {
  try {
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName,
      lastName,
    });
    // Qty-tracked unit label ("50 units") for this kit's slice, or null
    // for INDIVIDUAL / missing quantity — in which case we keep the
    // original countless phrasing ("added asset to ...").
    const count = formatUnitCount({ type, unitOfMeasure }, quantity);
    let message = "";

    /** User is changing from kit to another */
    if (currentKit && newKit && currentKit.id !== newKit.id) {
      const currentKitLink = wrapKitsWithDataForNote(
        { id: currentKit.id, name: currentKit.name.trim() },
        "updated"
      );
      const newKitLink = wrapKitsWithDataForNote(
        { id: newKit.id, name: newKit.name.trim() },
        "updated"
      );
      message = `${userLink} changed kit  from ${currentKitLink} to ${newKitLink}.`;
    }

    /** User is adding asset to a kit for first time */
    if (newKit && !currentKit) {
      const newKitLink = wrapKitsWithDataForNote(
        { id: newKit.id, name: newKit.name.trim() },
        "added"
      );
      // Qty-tracked: name the units added ("added 50 units to Camera Kit");
      // INDIVIDUAL keeps the original "added asset to ..." wording.
      message = count
        ? `${userLink} added ${count} to ${newKitLink}.`
        : `${userLink} added asset to ${newKitLink}.`;
    }

    /** User is removing the asset from kit */
    if (isRemoving && !newKit) {
      if (currentKit) {
        const currentKitLink = wrapKitsWithDataForNote(
          { id: currentKit.id, name: currentKit.name.trim() },
          "removed"
        );
        // Qty-tracked: name the units removed ("removed 50 units from
        // Camera Kit"); INDIVIDUAL keeps "removed asset from ...".
        message = count
          ? `${userLink} removed ${count} from ${currentKitLink}.`
          : `${userLink} removed asset from ${currentKitLink}.`;
      } else {
        message = `${userLink} removed asset from a kit.`;
      }
    }

    if (!message) {
      return;
    }

    await createNote({
      content: message,
      type: "UPDATE",
      userId,
      assetId,
      organizationId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a kit change note. Please try again or contact support",
      additionalData: { userId, assetId },
      label,
    });
  }
}

/**
 * Persist a per-side system note for a Phase 4c kit-axis "move units"
 * operation. Wording mirrors the location-axis move note:
 *
 *   `{user} moved {N units} from kit {KitX-link} to kit {KitY-link}.`
 *
 * Called twice per move — once for the from-side and once for the to-side —
 * so both kit pages and the asset feed have a chronological record of the
 * redistribution. INDIVIDUAL assets omit the unit-count fragment to match
 * the rest of the kit-note family.
 *
 * Writes through the global `db` (no tx) to mirror `createKitChangeNote`.
 * The paired ActivityEvents are the source of truth for tx atomicity; notes
 * are surfaced UI sugar that lands post-tx if the move commits.
 *
 * @param params.fromKit - Source kit (asset is losing units from here)
 * @param params.toKit - Destination kit (asset is gaining units here)
 * @param params.firstName / params.lastName - Acting user (for the userLink)
 * @param params.assetId - Asset whose units are being redistributed
 * @param params.userId - Acting user — written to `Note.userId`
 * @param params.organizationId - Caller's validated organization ID
 * @param params.type - `AssetType` — decides whether to render a unit count
 * @param params.unitOfMeasure - Labels the count ("pairs" / "boxes"); defaults to "units"
 * @param params.quantity - Number of units moved in this redistribution
 * @throws {ShelfError} On DB failure
 */
export async function createKitMoveNote({
  fromKit,
  toKit,
  firstName,
  lastName,
  assetId,
  userId,
  organizationId,
  type,
  unitOfMeasure,
  quantity,
}: {
  fromKit: Pick<Kit, "id" | "name">;
  toKit: Pick<Kit, "id" | "name">;
  firstName: string;
  lastName: string;
  assetId: Asset["id"];
  userId: User["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  /** Asset type — decides whether a qty-tracked unit count applies. */
  type: AssetType;
  /** Labels the count ("units" / "pairs"); defaults to "units". */
  unitOfMeasure?: string | null;
  /** Number of units moved in this redistribution. */
  quantity: number;
}) {
  try {
    const userLink = wrapUserLinkForNote({
      id: userId,
      firstName,
      lastName,
    });

    const fromKitLink = wrapKitsWithDataForNote(
      { id: fromKit.id, name: fromKit.name.trim() },
      "updated"
    );
    const toKitLink = wrapKitsWithDataForNote(
      { id: toKit.id, name: toKit.name.trim() },
      "updated"
    );

    // Qty-tracked: "moved 50 units from kit A to kit B"; INDIVIDUAL falls
    // back to the countless wording to match the rest of the kit-note family.
    const count = formatUnitCount({ type, unitOfMeasure }, quantity);
    const message = count
      ? `${userLink} moved ${count} from kit ${fromKitLink} to kit ${toKitLink}.`
      : `${userLink} moved asset from kit ${fromKitLink} to kit ${toKitLink}.`;

    await createNote({
      content: message,
      type: "UPDATE",
      userId,
      assetId,
      organizationId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating a kit move note. Please try again or contact support",
      additionalData: {
        userId,
        assetId,
        fromKitId: fromKit.id,
        toKitId: toKit.id,
      },
      label,
    });
  }
}

export async function createTagChangeNoteIfNeeded({
  assetId,
  userId,
  organizationId,
  previousTags,
  currentTags,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  previousTags: TagSummary[];
  currentTags: TagSummary[];
  loadUserForNotes: () => Promise<BasicUserName>;
}) {
  const previousTagIds = new Set(previousTags.map((tag) => tag.id));
  const currentTagIds = new Set(currentTags.map((tag) => tag.id));

  const addedTags = currentTags.filter((tag) => !previousTagIds.has(tag.id));
  const removedTags = previousTags.filter((tag) => !currentTagIds.has(tag.id));

  if (addedTags.length === 0 && removedTags.length === 0) {
    return;
  }

  const user = await loadUserForNotes();
  const userLink = wrapUserLinkForNote({
    id: userId,
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
  });

  const formatTagNames = (tagList: TagSummary[]) =>
    tagList
      .map((tag) =>
        wrapTagForNote({
          id: tag.id,
          name: (tag.name ?? "Unnamed tag").trim(),
        })
      )
      .join(tagList.length > 1 ? ", " : "");

  const actions: string[] = [];

  if (addedTags.length > 0) {
    actions.push(
      `added tag${addedTags.length > 1 ? "s" : ""} ${formatTagNames(addedTags)}`
    );
  }

  if (removedTags.length > 0) {
    actions.push(
      `removed tag${removedTags.length > 1 ? "s" : ""} ${formatTagNames(
        removedTags
      )}`
    );
  }

  if (actions.length === 0) {
    return;
  }

  const content = `${userLink} ${actions.join(" and ")}.`;

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
    organizationId,
  });
}

/**
 * Persist a note capturing asset name changes using the text diff helper.
 */
export async function createAssetNameChangeNote({
  assetId,
  userId,
  organizationId,
  previousName,
  newName,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  previousName?: string | null;
  newName?: string | null;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildNameChangeNote({
    userLink,
    previous: previousName,
    next: newName,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
    organizationId,
  });
}

/**
 * Persist a note describing updates to the asset description.
 */
export async function createAssetDescriptionChangeNote({
  assetId,
  userId,
  organizationId,
  previousDescription,
  newDescription,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  previousDescription?: string | null;
  newDescription?: string | null;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildDescriptionChangeNote({
    userLink,
    previous: previousDescription,
    next: newDescription,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
    organizationId,
  });
}

/**
 * Persist a note when the asset category is added, changed, or removed.
 */
export async function createAssetCategoryChangeNote({
  assetId,
  userId,
  organizationId,
  previousCategory,
  newCategory,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  previousCategory?: Pick<Category, "id" | "name" | "color"> | null;
  newCategory?: Pick<Category, "id" | "name" | "color"> | null;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildCategoryChangeNote({
    userLink,
    previous: previousCategory,
    next: newCategory,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
    organizationId,
  });
}

/**
 * Persist a note highlighting valuation adjustments with formatted currency values.
 */
export async function createAssetValuationChangeNote({
  assetId,
  userId,
  organizationId,
  previousValuation,
  newValuation,
  currency,
  locale,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  userId: User["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  previousValuation?: Prisma.Decimal | number | null;
  newValuation?: Prisma.Decimal | number | null;
  currency: Currency;
  locale: string;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = buildValuationChangeNote({
    userLink,
    previous: previousValuation,
    next: newValuation,
    currency,
    locale,
  });

  if (!content) {
    return;
  }

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
    organizationId,
  });
}

/**
 * Create asset notes when assets are added to an audit
 */
export async function createAssetNotesForAuditAddition({
  assetIds,
  userId,
  audit,
  organizationId,
}: {
  assetIds: Asset["id"][];
  userId: User["id"];
  audit: Pick<AuditSession, "id" | "name">;
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
}) {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    });

    if (!user || assetIds.length === 0) return;

    const userLink = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
    });

    const auditLink = wrapLinkForNote(
      `/audits/${audit.id}/overview`,
      audit.name
    );

    const content = `${userLink} added asset to audit ${auditLink}.`;

    await createNotes({
      content,
      type: "UPDATE",
      userId,
      assetIds,
      organizationId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating asset notes for audit addition",
      additionalData: { userId, assetIds, auditId: audit.id },
      label,
    });
  }
}

/**
 * Create asset notes when assets are removed from an audit
 */
export async function createAssetNotesForAuditRemoval({
  assetIds,
  userId,
  audit,
  organizationId,
}: {
  assetIds: Asset["id"][];
  userId: User["id"];
  audit: Pick<AuditSession, "id" | "name">;
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
}) {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, firstName: true, lastName: true, displayName: true },
    });

    if (!user || assetIds.length === 0) return;

    const userLink = wrapUserLinkForNote({
      id: user.id,
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
    });

    const auditLink = wrapLinkForNote(
      `/audits/${audit.id}/overview`,
      audit.name
    );

    const content = `${userLink} removed asset from audit ${auditLink}.`;

    await createNotes({
      content,
      type: "UPDATE",
      userId,
      assetIds,
      organizationId,
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message:
        "Something went wrong while creating asset notes for audit removal",
      additionalData: { userId, assetIds, auditId: audit.id },
      label,
    });
  }
}

/** Human-readable label for ConsumptionType values */
function consumptionTypeLabel(
  type: ConsumptionType | null | undefined
): string {
  if (type === "ONE_WAY") return "Used up (one-way)";
  if (type === "TWO_WAY") return "Returnable (two-way)";
  return "—";
}

/**
 * Persist a note when quantity-related fields are changed via the edit form.
 *
 * Tracks changes to: quantity, minQuantity, consumptionType, unitOfMeasure.
 * Only creates a note when at least one field actually changed.
 */
export async function createAssetQuantityChangeNote({
  assetId,
  organizationId,
  userId,
  previousQuantity,
  newQuantity,
  previousMinQuantity,
  newMinQuantity,
  previousConsumptionType,
  newConsumptionType,
  previousUnitOfMeasure,
  newUnitOfMeasure,
  loadUserForNotes,
}: {
  assetId: Asset["id"];
  /** Caller's validated org — propagated to the note's asset ownership check */
  organizationId: string;
  userId: User["id"];
  previousQuantity?: number | null;
  newQuantity?: number | null;
  previousMinQuantity?: number | null;
  newMinQuantity?: number | null;
  previousConsumptionType?: ConsumptionType | null;
  newConsumptionType?: ConsumptionType | null;
  previousUnitOfMeasure?: string | null;
  newUnitOfMeasure?: string | null;
  loadUserForNotes: LoadUserForNotesFn;
}) {
  const changes: string[] = [];

  if (
    newQuantity !== undefined &&
    (previousQuantity ?? null) !== (newQuantity ?? null)
  ) {
    changes.push(
      `total quantity from **${previousQuantity ?? "—"}** to **${
        newQuantity ?? "—"
      }**`
    );
  }

  if (
    newMinQuantity !== undefined &&
    (previousMinQuantity ?? null) !== (newMinQuantity ?? null)
  ) {
    changes.push(
      `low-stock threshold from **${previousMinQuantity ?? "—"}** to **${
        newMinQuantity ?? "—"
      }**`
    );
  }

  if (
    newConsumptionType !== undefined &&
    (previousConsumptionType ?? null) !== (newConsumptionType ?? null)
  ) {
    changes.push(
      `behavior from **${consumptionTypeLabel(
        previousConsumptionType
      )}** to **${consumptionTypeLabel(newConsumptionType)}**`
    );
  }

  if (
    newUnitOfMeasure !== undefined &&
    (previousUnitOfMeasure ?? null) !== (newUnitOfMeasure ?? null)
  ) {
    const prevLabel = sanitizeUnitOfMeasureLabel(previousUnitOfMeasure) || "—";
    const nextLabel = sanitizeUnitOfMeasureLabel(newUnitOfMeasure) || "—";
    changes.push(`unit of measure from **${prevLabel}** to **${nextLabel}**`);
  }

  if (changes.length === 0) return;

  const userLink = await resolveUserLink({ userId, loadUserForNotes });
  const content = `${userLink} updated ${changes.join(", ")}.`;

  await createNote({
    content,
    type: "UPDATE",
    userId,
    assetId,
    organizationId,
  });
}
