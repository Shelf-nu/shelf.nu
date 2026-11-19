/**
 * Create assets from stock.
 *
 * Takes N units out of a quantity-tracked pool and creates N individually
 * tracked assets from them, in one transaction:
 *
 * 1. The pool goes down by N through `applyQuantityAdjustment`, the locked
 *    path the Adjust dialog uses, so the same holds refuse it: the chosen
 *    source's units left, custody, kits, bookings and manual placements. The
 *    stock ledger records the units as `CONVERTED`.
 * 2. The N assets are written in the same transaction, each with the pool's
 *    description, category, tags, booking availability, per-unit valuation
 *    and custom field values, plus the chosen model and the source location.
 * 3. One note on the pool links the new assets; one note on each new asset
 *    links back to the pool.
 *
 * A failure anywhere rolls all of it back, and the pool's row lock is held
 * from the check to the commit, so two people converting at once can never
 * take more units than are free. The main image is copied after the commit,
 * best effort, like a duplicate's.
 *
 * @see {@link file://../consumption-log/service.server.ts} `applyQuantityAdjustment`
 * @see {@link file://../../routes/_layout+/assets.$assetId.overview.create-from-stock.tsx}
 */

import { AssetType, ErrorCorrection, Prisma } from "@prisma/client";
import type { Asset } from "@prisma/client";
import { db } from "~/database/db.server";
import { LONG_TRANSACTION_OPTIONS } from "~/database/transaction-options.server";
import { recordEvent } from "~/modules/activity-event/service.server";
import { planModelDefaultFill } from "~/modules/asset-model/defaults";
import { getAssetModelsDefaults } from "~/modules/asset-model/defaults.server";
import { checkAndNotifyLowStock } from "~/modules/consumption-log/low-stock.server";
import { lockAssetForQuantityUpdate } from "~/modules/consumption-log/quantity-lock.server";
import type { QuantityAdjustmentTxClient } from "~/modules/consumption-log/service.server";
import {
  applyQuantityAdjustment,
  writeAdjustmentLocationNotes,
} from "~/modules/consumption-log/service.server";
import {
  createAssetLocationMoveNotes,
  firstPlacementMove,
} from "~/modules/location-note/service.server";
import { createNote } from "~/modules/note/service.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { ShelfError } from "~/utils/error";
import type { ErrorLabel } from "~/utils/error";
import { id } from "~/utils/id/id.server";
import { Logger } from "~/utils/logger";
import {
  wrapAssetsWithDataForNote,
  wrapLinkForNote,
  wrapUserLinkForNote,
} from "~/utils/markdoc-wrappers";
import { threeDaysFromNow } from "~/utils/one-week-from-now";
import { assertAssetModelBelongsToOrg } from "~/utils/org-validation.server";
import { readCommittedUnits } from "./availability-primitives.server";
import {
  assetsFromStockTitles,
  MAX_ASSETS_FROM_STOCK,
} from "./create-from-stock";
import type { CustodySourceOption } from "./custody-source";
import { buildCustodySourceOptions } from "./custody-source";
import { loadCustodySources } from "./custody-source.server";
import { getNextSequentialIds } from "./sequential-id.server";
import { uploadDuplicateAssetMainImage } from "./service.server";

const label: ErrorLabel = "Assets";

/** Attempts at the whole transaction when a sequential id collides. */
const MAX_ATTEMPTS = 3;

/** What the dialog asks for. */
export type CreateAssetsFromStockInput = {
  /** The quantity-tracked pool the units come from. */
  poolId: string;
  organizationId: string;
  userId: string;
  /** How many units to take out, one asset each. */
  count: number;
  /**
   * Where the units come from and the new assets are placed: a location id
   * of one of the pool's placements, or the unplaced source.
   */
  source: string;
  /** The name typed in the dialog; several assets get " 1", " 2", ... */
  title: string;
  /** An asset model for every new asset. */
  assetModelId?: string | null;
};

/** The assets made and where they were placed. */
export type CreateAssetsFromStockResult = {
  assets: { id: string; title: string }[];
  locationId: string | null;
};

/**
 * Creates `count` individually tracked assets from free units of a
 * quantity-tracked pool, and lowers the pool by the same amount. See the
 * module header for what is copied and why it is one transaction.
 *
 * @returns The new assets, in name order, and where they were placed
 * @throws {ShelfError} 400 when the pool is not quantity-tracked, is
 *   archived, the count is out of range, or the source does not have that
 *   many free units; 404 when the pool, location or model is not in the
 *   workspace
 */
export async function createAssetsFromStock(
  input: CreateAssetsFromStockInput
): Promise<CreateAssetsFromStockResult> {
  const { poolId, organizationId, userId, count, source } = input;
  const title = input.title.trim();

  if (!Number.isInteger(count) || count < 1 || count > MAX_ASSETS_FROM_STOCK) {
    throw new ShelfError({
      cause: null,
      message: `Choose between 1 and ${MAX_ASSETS_FROM_STOCK} assets.`,
      additionalData: { poolId, count },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }
  if (!title) {
    throw new ShelfError({
      cause: null,
      message: "Name the new assets.",
      additionalData: { poolId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const { pool, created, adjustment, actor } = await db.$transaction(
        (tx) => convertInTransaction(tx, { ...input, title }),
        LONG_TRANSACTION_OPTIONS
      );

      await afterCommit({ pool, created, adjustment, actor, userId, count });

      return {
        assets: created.map(({ id, title }) => ({ id, title })),
        locationId: adjustment.location.locationId,
      };
    } catch (cause) {
      if (isSequentialIdCollision(cause) && attempt < MAX_ATTEMPTS) continue;
      if (cause instanceof ShelfError) throw cause;
      throw new ShelfError({
        cause,
        message:
          "Something went wrong while creating assets from stock. Please try again or contact support.",
        additionalData: { poolId, organizationId, count, source },
        label,
      });
    }
  }
}

/** A sequential id another writer took between allocation and insert. */
function isSequentialIdCollision(cause: unknown) {
  if (!(cause instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const target = cause.meta?.target;
  return (
    cause.code === "P2002" &&
    (Array.isArray(target)
      ? target.includes("sequentialId")
      : String(target ?? "").includes("sequentialId"))
  );
}

/** The pool fields the new assets copy. */
const POOL_SELECT = {
  id: true,
  title: true,
  type: true,
  unitOfMeasure: true,
  archivedAt: true,
  description: true,
  categoryId: true,
  valuation: true,
  availableToBook: true,
  mainImage: true,
  tags: { select: { id: true } },
  customFields: {
    where: { customField: { active: true, deletedAt: null } },
    select: { customFieldId: true, value: true },
  },
} satisfies Prisma.AssetSelect;

type Pool = Prisma.AssetGetPayload<{ select: typeof POOL_SELECT }>;

type Created = Pick<Asset, "id" | "title" | "type" | "unitOfMeasure">;

async function convertInTransaction(
  tx: QuantityAdjustmentTxClient,
  {
    poolId,
    organizationId,
    userId,
    count,
    source,
    title,
    assetModelId,
  }: CreateAssetsFromStockInput
) {
  // The lock comes first: every read below, and the adjustment's checks,
  // see the pool as it is until the commit.
  await lockAssetForQuantityUpdate(tx, poolId, organizationId);

  const pool: Pool = await tx.asset.findFirstOrThrow({
    // eslint-disable-next-line local-rules/require-archived-at-check-on-asset-queries -- why: reads the archive state to refuse an archived pool with its own message
    where: { id: poolId, organizationId },
    select: POOL_SELECT,
  });

  if (pool.type !== AssetType.QUANTITY_TRACKED) {
    throw new ShelfError({
      cause: null,
      message: "Only quantity-tracked assets have stock to create assets from.",
      additionalData: { poolId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }
  if (pool.archivedAt) {
    throw new ShelfError({
      cause: null,
      title: "Asset is archived",
      message: "Reinstate this asset before creating assets from its stock.",
      additionalData: { poolId },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const model = assetModelId
    ? await assertAssetModelBelongsToOrg({ assetModelId, organizationId }, tx)
    : null;

  // Lowers the total at the source, under the same checks as a removal in
  // the Adjust dialog. Throws, and so rolls everything back, when the
  // source has fewer free units than asked for.
  const adjustment = await applyQuantityAdjustment(tx, {
    assetId: poolId,
    quantity: count,
    category: "CONVERTED",
    direction: "subtract",
    userId,
    organizationId,
    locationId: source,
  });
  const locationId = adjustment.location.locationId;

  // A model's defaults fill what the pool leaves empty, as when an asset
  // joins a model anywhere else.
  let categoryId = pool.categoryId;
  let valuation = pool.valuation;
  const customFieldValues = pool.customFields.map((field) => ({
    customFieldId: field.customFieldId,
    value: field.value as Prisma.InputJsonValue,
  }));
  if (model) {
    const defaults = (
      await getAssetModelsDefaults(
        { assetModelIds: [model.id], organizationId },
        tx
      )
    ).get(model.id);
    if (defaults) {
      const fill = planModelDefaultFill({
        model: defaults,
        current: {
          categoryId,
          valuation,
          customFieldIdsWithValue: new Set(
            customFieldValues.map((field) => field.customFieldId)
          ),
        },
      });
      categoryId = fill.categoryId ?? categoryId;
      valuation = fill.valuation ?? valuation;
      for (const fieldDefault of fill.customFields) {
        customFieldValues.push({
          customFieldId: fieldDefault.customFieldId,
          value: fieldDefault.value as unknown as Prisma.InputJsonValue,
        });
      }
    }
  }

  const titles = assetsFromStockTitles(title, count);
  const sequentialIds = await getNextSequentialIds(organizationId, count, tx);
  const created: Created[] = [];

  for (const [index, assetTitle] of titles.entries()) {
    const asset = await tx.asset.create({
      data: {
        title: assetTitle,
        description: pool.description,
        sequentialId: sequentialIds[index],
        type: AssetType.INDIVIDUAL,
        // The pool's valuation is per unit (its total value is valuation
        // times quantity), so each asset made from one unit carries it.
        valuation,
        availableToBook: pool.availableToBook,
        user: { connect: { id: userId } },
        organization: { connect: { id: organizationId } },
        qrCodes: {
          create: {
            id: id(),
            version: 0,
            errorCorrection: ErrorCorrection.L,
            user: { connect: { id: userId } },
            organization: { connect: { id: organizationId } },
          },
        },
        ...(categoryId && { category: { connect: { id: categoryId } } }),
        ...(model && { assetModel: { connect: { id: model.id } } }),
        ...(pool.tags.length > 0 && {
          tags: { connect: pool.tags.map((tag) => ({ id: tag.id })) },
        }),
        ...(customFieldValues.length > 0 && {
          customFields: { create: customFieldValues },
        }),
      },
      select: { id: true, title: true, type: true, unitOfMeasure: true },
    });
    created.push(asset);

    if (locationId) {
      await tx.assetLocation.create({
        data: { assetId: asset.id, locationId, organizationId, quantity: 1 },
      });
    }

    await recordEvent(
      {
        organizationId,
        actorUserId: userId,
        action: "ASSET_CREATED",
        entityType: "ASSET",
        entityId: asset.id,
        assetId: asset.id,
      },
      tx
    );
    if (locationId) {
      await recordEvent(
        {
          organizationId,
          actorUserId: userId,
          action: "ASSET_LOCATION_CHANGED",
          entityType: "ASSET",
          entityId: asset.id,
          assetId: asset.id,
          locationId,
          field: "locationId",
          fromValue: null,
          toValue: locationId,
        },
        tx
      );
    }
  }

  const actor = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, ...USER_NAME_SELECT },
  });
  const actorLink = wrapUserLinkForNote(actor);
  const poolLink = wrapLinkForNote(`/assets/${pool.id}`, pool.title);

  await createNote(
    {
      content: `${actorLink} created ${wrapAssetsWithDataForNote(
        created,
        "created"
      )} from this stock. The stock went down by **${count}**.`,
      type: "UPDATE",
      userId,
      assetId: pool.id,
      organizationId,
    },
    tx
  );
  for (const asset of created) {
    await createNote(
      {
        content: `${actorLink} created this asset from the stock of ${poolLink}.`,
        type: "UPDATE",
        userId,
        assetId: asset.id,
        organizationId,
      },
      tx
    );
  }

  return { pool, created, adjustment, actor };
}

/** Image copies run this many at a time, so a full batch stays well inside a request. */
const IMAGE_COPY_CONCURRENCY = 5;

/**
 * How long the request waits for image copies, well inside the platform's
 * request limit (100 s behind Cloudflare). Later copies finish after the
 * response; each one logs its own failure.
 */
const IMAGE_COPY_WAIT_MS = 20_000;

/**
 * Everything after the commit, best effort: the location timelines, the
 * copied main image and the low-stock check. The assets and the lower total
 * are saved; none of this can undo them.
 */
async function afterCommit({
  pool,
  created,
  adjustment,
  actor,
  userId,
  count,
}: {
  pool: Pool;
  created: Created[];
  adjustment: Awaited<ReturnType<typeof applyQuantityAdjustment>>;
  actor: Parameters<typeof createAssetLocationMoveNotes>[0]["actor"];
  userId: string;
  count: number;
}) {
  await writeAdjustmentLocationNotes({
    result: adjustment,
    userId,
    quantity: count,
    category: "CONVERTED",
    direction: "subtract",
  });

  const { locationId, locationName } = adjustment.location;
  if (locationId) {
    try {
      await createAssetLocationMoveNotes({
        moves: created.map((asset) =>
          firstPlacementMove(
            asset,
            { id: locationId, name: locationName ?? "" },
            1
          )
        ),
        actor,
      });
    } catch (cause) {
      Logger.error(
        new ShelfError({
          cause,
          message: "Could not write the location line for assets from stock",
          additionalData: { poolId: pool.id, locationId },
          label,
        })
      );
    }
  }

  const mainImage = pool.mainImage;
  if (mainImage) {
    const copyImage = async (asset: Created) => {
      try {
        const imagePath = await uploadDuplicateAssetMainImage(
          mainImage,
          asset.id,
          userId
        );
        if (typeof imagePath === "string") {
          await db.asset.update({
            // eslint-disable-next-line local-rules/require-org-scope-on-id-queries -- idor-safe: `asset.id` was created in this request's org-scoped transaction
            where: { id: asset.id },
            data: {
              mainImage: imagePath,
              mainImageExpiration: threeDaysFromNow(),
            },
          });
        }
      } catch (cause) {
        Logger.error(
          new ShelfError({
            cause,
            message: "Skipping the image of an asset created from stock",
            additionalData: { assetId: asset.id, poolId: pool.id, userId },
            label,
          })
        );
      }
    };
    const copies = (async () => {
      for (let i = 0; i < created.length; i += IMAGE_COPY_CONCURRENCY) {
        await Promise.all(
          created.slice(i, i + IMAGE_COPY_CONCURRENCY).map(copyImage)
        );
      }
    })();
    // The conversion is saved, so the response never waits past the
    // deadline for pictures: copies still running finish on their own.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      copies,
      new Promise((resolve) => {
        timer = setTimeout(resolve, IMAGE_COPY_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
  }

  await checkAndNotifyLowStock({
    assetId: pool.id,
    userId,
    organizationId: adjustment.asset.organizationId,
  });
}

/** What the dialog shows before anything is submitted. */
export type AssetsFromStockChoices = {
  /** Units no custody, kit or booking reservation holds. */
  free: number;
  /**
   * Where the units can come from: one option per placement, then
   * "Unplaced" when there are unplaced units. Each says how many it has left.
   */
  options: CustodySourceOption[];
};

/**
 * Reads the dialog's numbers for a pool: the free units and the sources.
 * The submit checks the same numbers again under the pool's lock; these
 * only set the field's maximum and the pre-selected source.
 *
 * @param args.assetId - A pool already org-verified by the caller's loader
 * @param args.organizationId - The caller's organization
 * @param args.total - `Asset.quantity`
 */
export async function getAssetsFromStockChoices({
  assetId,
  organizationId,
  total,
}: {
  assetId: string;
  organizationId: string;
  total: number;
}): Promise<AssetsFromStockChoices> {
  const [{ state }, { committed }] = await Promise.all([
    loadCustodySources(db, { assetId, total }),
    readCommittedUnits({ assetId, organizationId, tx: db }),
  ]);
  const locations = await db.location.findMany({
    where: {
      id: { in: state.placements.map((p) => p.locationId) },
      organizationId,
    },
    select: { id: true, name: true, parent: { select: { name: true } } },
  });
  return {
    free: Math.max(0, total - committed),
    options: buildCustodySourceOptions(
      state,
      locations.map((l) => ({
        id: l.id,
        name: l.name,
        parentName: l.parent?.name ?? null,
      }))
    ),
  };
}
