/**
 * Asset model defaults: reading, saving and applying them.
 *
 * A model's defaults (category, valuation, custom field values) fill an
 * asset's EMPTY fields when the asset joins the model, and never overwrite.
 * The decision itself lives in the pure `planModelDefaultFill`; this module
 * wires it into the two ways an asset joins a model:
 *
 * - **Through a form** (create, edit): `fillAssetFormDataFromModel` writes the
 *   defaults into the submitted form before it is validated, so required
 *   custom fields are satisfied and `createAsset` / `updateAsset` record the
 *   values with their usual notes and events.
 * - **In bulk** (bulk assign, "fill linked assets"):
 *   `applyAssetModelDefaultsToAssets` fills rows inside the caller's
 *   transaction and writes one note per asset plus one event per field.
 *
 * @see {@link file://./defaults.ts}
 * @see {@link file://./../../components/asset-model/form.tsx}
 */
import { Prisma } from "@prisma/client";
import type { Currency, CustomField, Organization, User } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { z } from "zod";
import type { ExtendedPrismaClient } from "~/database/db.server";
import { db } from "~/database/db.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import { lockAssetsForArchiveGuard } from "~/modules/asset/archive-lock.server";
import type { ICustomFieldValueJson } from "~/modules/asset/types";
import {
  formatCurrencyForNote,
  resolveUserLink,
} from "~/modules/note/helpers.server";
import { createLoadUserForNotes } from "~/modules/note/load-user-for-notes.server";
import { createNotes } from "~/modules/note/service.server";
import {
  extractCustomFieldValuesFromPayload,
  mergedSchema,
  toCustomFieldZodSchema,
} from "~/utils/custom-fields";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError } from "~/utils/error";
import { parseData } from "~/utils/http.server";
import { stripMarkdocDelimiters } from "~/utils/markdoc-sanitize";
import { wrapCategoryForNote, wrapLinkForNote } from "~/utils/markdoc-wrappers";
import type { AssetModelDefaults, ModelDefaultFill } from "./defaults";
import {
  MODEL_DEFAULT_FIELD_TYPES,
  defaultValueToFormString,
  isEmptyFill,
  isUsableFieldDefault,
  planModelDefaultFill,
} from "./defaults";

const label: ErrorLabel = "Asset Model";

/**
 * Transaction client the bulk fill reads and writes through. The extended
 * client's `$transaction` callback param is not assignable to the generated
 * `Prisma.TransactionClient`, so the tx-denied members are omitted instead.
 */
export type ModelDefaultsTxClient = Omit<
  ExtendedPrismaClient,
  ITXClientDenyList
>;

/**
 * Reads the defaults of several models, scoped to the organization, in two
 * queries.
 *
 * The field definitions are the second query: `customFieldId` has no Prisma
 * relation (see the schema). A default whose field is deleted is dropped.
 *
 * @param params.assetModelIds - The models, usually from form or file input
 * @param params.organizationId - Caller's organization; models from another
 *   organization are left out
 * @param tx - Optional transaction client
 * @returns The defaults of each model found, by model id
 */
export async function getAssetModelsDefaults(
  {
    assetModelIds,
    organizationId,
  }: { assetModelIds: string[]; organizationId: Organization["id"] },
  tx: ModelDefaultsTxClient = db
): Promise<Map<string, AssetModelDefaults>> {
  if (assetModelIds.length === 0) {
    return new Map();
  }

  const models = await tx.assetModel.findMany({
    where: { id: { in: assetModelIds }, organizationId },
    select: {
      id: true,
      name: true,
      defaultCategoryId: true,
      defaultValuation: true,
      customFieldDefaults: { select: { customFieldId: true, value: true } },
    },
  });

  const fieldIds = [
    ...new Set(
      models.flatMap((model) =>
        model.customFieldDefaults.map((d) => d.customFieldId)
      )
    ),
  ];
  const fields = fieldIds.length
    ? await tx.customField.findMany({
        where: {
          id: { in: fieldIds },
          organizationId,
          // A deleted field's default is never used, so it is not read.
          deletedAt: null,
        },
        select: {
          id: true,
          name: true,
          type: true,
          active: true,
          deletedAt: true,
          options: true,
          categories: { select: { id: true } },
        },
      })
    : [];
  const fieldsById = new Map(fields.map((field) => [field.id, field]));

  return new Map(
    models.map((model) => [
      model.id,
      {
        ...model,
        customFieldDefaults: model.customFieldDefaults.flatMap(
          (fieldDefault) => {
            const customField = fieldsById.get(fieldDefault.customFieldId);
            return customField
              ? [
                  {
                    customFieldId: fieldDefault.customFieldId,
                    value:
                      fieldDefault.value as unknown as ICustomFieldValueJson,
                    customField,
                  },
                ]
              : [];
          }
        ),
      },
    ])
  );
}

/**
 * Reads one model's defaults, scoped to the organization.
 *
 * @param params.assetModelId - The model, usually from form input
 * @param params.organizationId - Caller's organization; a model from another
 *   organization reads as `null`
 * @param tx - Optional transaction client
 * @returns The model's defaults, or `null` when it is not in this organization
 */
export async function getAssetModelDefaults(
  {
    assetModelId,
    organizationId,
  }: { assetModelId: string; organizationId: Organization["id"] },
  tx: ModelDefaultsTxClient = db
): Promise<AssetModelDefaults | null> {
  const models = await getAssetModelsDefaults(
    { assetModelIds: [assetModelId], organizationId },
    tx
  );
  return models.get(assetModelId) ?? null;
}

/** What a saved asset already holds, for the edit form's fill decision. */
export type StoredAssetFields = {
  categoryId: string | null;
  valuation: number | null;
  customFieldIdsWithValue: ReadonlySet<string>;
};

/**
 * Fills a submitted asset form's empty fields from a model, in place.
 *
 * Runs before the form is validated, so a required custom field the model
 * fills passes validation, and the asset service records the filled values
 * like any typed value. A field counts as empty only when the form left it
 * blank AND, on the edit form, the saved asset has no value for it either.
 *
 * @param params.formData - The submitted asset form (mutated)
 * @param params.model - The model the asset joins
 * @param params.stored - The saved asset's values (edit form only)
 * @returns The fill that was applied
 */
export function fillAssetFormDataFromModel({
  formData,
  model,
  stored,
}: {
  formData: FormData;
  model: AssetModelDefaults;
  stored?: StoredAssetFields;
}): ModelDefaultFill {
  const blank = (key: string) => {
    const value = formData.get(key);
    return typeof value !== "string" || value.trim() === "";
  };

  const formCategory = formData.get("category");
  // "uncategorized" counts as blank here: the form's category select shows
  // Uncategorized when nothing was chosen, so it cannot tell a deliberate
  // choice from no choice. The import differs (`categoryCleared` in
  // `import-update.server.ts`): a cleared Category cell is always an answer.
  const categoryIsBlank = blank("category") || formCategory === "uncategorized";

  const formCustomFieldIds = new Set(
    model.customFieldDefaults
      .map((fieldDefault) => fieldDefault.customFieldId)
      .filter((id) => !blank(`cf-${id}`))
  );

  const fill = planModelDefaultFill({
    model,
    current: {
      categoryId: categoryIsBlank
        ? stored?.categoryId ?? null
        : String(formCategory),
      valuation: blank("valuation")
        ? stored?.valuation ?? null
        : Number(formData.get("valuation")),
      customFieldIdsWithValue: new Set([
        ...formCustomFieldIds,
        ...(stored?.customFieldIdsWithValue ?? []),
      ]),
    },
  });

  if (fill.categoryId !== undefined) {
    formData.set("category", fill.categoryId);
  }
  if (fill.valuation !== undefined) {
    formData.set("valuation", String(fill.valuation));
  }
  for (const fieldDefault of fill.customFields) {
    formData.set(
      `cf-${fieldDefault.customFieldId}`,
      defaultValueToFormString(fieldDefault.value)
    );
  }

  return fill;
}

/** The display text of a stored custom field value, for notes. */
function noteValueText(value: ICustomFieldValueJson) {
  return stripMarkdocDelimiters(defaultValueToFormString(value));
}

/**
 * Builds the note recording which empty fields a model filled on an asset.
 *
 * @param params.userLink - Rendered link to the acting user
 * @param params.model - The model that filled the fields
 * @param params.parts - Already-formatted `label value` fragments
 * @returns Markdoc note content
 */
export function buildModelDefaultsFillNote({
  userLink,
  model,
  parts,
}: {
  userLink: string;
  model: { id: string; name: string };
  parts: string[];
}) {
  const modelLink = wrapLinkForNote(
    `/settings/asset-models/${model.id}/edit`,
    model.name
  );
  return `${userLink} filled empty fields from the asset model ${modelLink}: ${parts.join(
    ", "
  )}.`;
}

/**
 * Reads a model's default category, scoped to the organization.
 *
 * A default category that no longer exists in this organization fills
 * nothing, so every path that plans a fill resolves it through here first.
 *
 * @param client - Database or transaction client
 * @param params.defaultCategoryId - The model's stored default category
 * @param params.organizationId - Caller's organization
 * @returns The category, or `null` when there is none to fill with
 */
async function findModelDefaultCategory(
  client: ModelDefaultsTxClient,
  {
    defaultCategoryId,
    organizationId,
  }: { defaultCategoryId: string | null; organizationId: Organization["id"] }
) {
  if (!defaultCategoryId) {
    return null;
  }
  return client.category.findFirst({
    where: { id: defaultCategoryId, organizationId },
    select: { id: true, name: true, color: true },
  });
}

/** One custom field value a model fill wants to insert. */
type CustomFieldValueInsert = {
  assetId: string;
  customFieldId: string;
  value: ICustomFieldValueJson;
};

/**
 * Inserts custom field values, skipping every (asset, field) pair that
 * already has a value when the insert runs.
 *
 * `AssetCustomFieldValue` has no unique (assetId, customFieldId), so a plain
 * insert after a read would duplicate a value saved between the two. The
 * existence check runs in the same statement as the insert, which keeps that
 * window to a single statement. `@updatedAt` has no database default, so it
 * is set here; the id is a text uuid like other raw inserts.
 *
 * @param tx - The transaction the fill runs in
 * @param rows - The values to insert
 * @returns `assetId:customFieldId` keys of the rows actually inserted
 */
async function insertMissingCustomFieldValues(
  tx: ModelDefaultsTxClient,
  rows: CustomFieldValueInsert[]
): Promise<Set<string>> {
  if (rows.length === 0) {
    return new Set();
  }
  const inserted = await tx.$queryRaw<
    { assetId: string; customFieldId: string }[]
  >(Prisma.sql`
    INSERT INTO "AssetCustomFieldValue"
      ("id", "assetId", "customFieldId", "value", "createdAt", "updatedAt")
    SELECT DISTINCT ON (v."assetId", v."customFieldId")
      gen_random_uuid()::text, v."assetId", v."customFieldId", v."value"::jsonb,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM unnest(
      ${rows.map((row) => row.assetId)}::text[],
      ${rows.map((row) => row.customFieldId)}::text[],
      ${rows.map((row) => JSON.stringify(row.value))}::text[]
    ) AS v("assetId", "customFieldId", "value")
    WHERE NOT EXISTS (
      SELECT 1 FROM "AssetCustomFieldValue" existing
      WHERE existing."assetId" = v."assetId"
        AND existing."customFieldId" = v."customFieldId"
    )
    RETURNING "assetId", "customFieldId"
  `);
  return new Set(
    inserted.map((row) => customFieldValueKey(row.assetId, row.customFieldId))
  );
}

/** Key of one (asset, custom field) pair. */
function customFieldValueKey(assetId: string, customFieldId: string) {
  return `${assetId}:${customFieldId}`;
}

/**
 * Fills the empty fields of assets that belong to a model, inside the
 * caller's transaction.
 *
 * Each asset is re-read on `tx`, so the decision uses the values the write
 * will actually replace. Archived assets are frozen and skipped. A custom
 * field value saved after the read is kept, and the model's value for it is
 * dropped. Every filled field emits its own `ASSET_*_CHANGED` event, and each
 * asset gets one note listing what was filled.
 *
 * @param tx - The transaction the caller's change runs in
 * @param params.model - The model's defaults
 * @param params.assetIds - Assets to fill (already org-validated by the caller)
 * @param params.userLink - Rendered link to the acting user, for the notes
 * @param params.currency - Organization currency, for the valuation in notes
 * @param params.locale - Request locale, for the valuation in notes
 * @returns How many assets and fields were filled
 */
export async function applyAssetModelDefaultsToAssets(
  tx: ModelDefaultsTxClient,
  {
    organizationId,
    userId,
    userLink,
    model,
    assetIds,
    currency,
    locale,
  }: {
    organizationId: Organization["id"];
    userId: User["id"];
    userLink: string;
    model: AssetModelDefaults;
    assetIds: string[];
    currency: Currency;
    locale: string;
  }
): Promise<{ assetsFilled: number; fieldsFilled: number }> {
  if (assetIds.length === 0) {
    return { assetsFilled: 0, fieldsFilled: 0 };
  }

  const defaultFieldIds = model.customFieldDefaults.map(
    (fieldDefault) => fieldDefault.customFieldId
  );

  // Membership is re-checked here: an asset moved off the model since the
  // caller collected the ids is not filled from it.
  const assets = await tx.asset.findMany({
    where: {
      id: { in: assetIds },
      organizationId,
      archivedAt: null,
      assetModelId: model.id,
    },
    select: {
      id: true,
      categoryId: true,
      valuation: true,
      customFields: {
        where: { customFieldId: { in: defaultFieldIds } },
        select: { customFieldId: true },
      },
    },
  });

  const category = await findModelDefaultCategory(tx, {
    defaultCategoryId: model.defaultCategoryId,
    organizationId,
  });

  const allPlanned = assets
    .map((asset) => ({
      asset,
      fill: planModelDefaultFill({
        model: {
          ...model,
          // A default category that no longer exists in this org fills nothing.
          defaultCategoryId: category?.id ?? null,
        },
        current: {
          categoryId: asset.categoryId,
          valuation: asset.valuation,
          customFieldIdsWithValue: new Set(
            asset.customFields.map((value) => value.customFieldId)
          ),
        },
      }),
    }))
    .filter(({ fill }) => !isEmptyFill(fill));

  if (allPlanned.length === 0) {
    return { assetsFilled: 0, fieldsFilled: 0 };
  }

  const categoryAssetIds = allPlanned
    .filter(({ fill }) => fill.categoryId !== undefined)
    .map(({ asset }) => asset.id);
  if (category && categoryAssetIds.length > 0) {
    await tx.asset.updateMany({
      where: { id: { in: categoryAssetIds }, organizationId },
      data: { categoryId: category.id },
    });
  }

  const valuationAssetIds = allPlanned
    .filter(({ fill }) => fill.valuation !== undefined)
    .map(({ asset }) => asset.id);
  if (model.defaultValuation !== null && valuationAssetIds.length > 0) {
    await tx.asset.updateMany({
      where: { id: { in: valuationAssetIds }, organizationId },
      data: { valuation: model.defaultValuation },
    });
  }

  const insertedKeys = await insertMissingCustomFieldValues(
    tx,
    allPlanned.flatMap(({ asset, fill }) =>
      fill.customFields.map((fieldDefault) => ({
        assetId: asset.id,
        customFieldId: fieldDefault.customFieldId,
        value: fieldDefault.value,
      }))
    )
  );

  // Events and notes describe only what was written: a custom field value
  // that already existed at insert time is not reported as filled.
  const planned = allPlanned
    .map(({ asset, fill }) => ({
      asset,
      fill: {
        ...fill,
        customFields: fill.customFields.filter((fieldDefault) =>
          insertedKeys.has(
            customFieldValueKey(asset.id, fieldDefault.customFieldId)
          )
        ),
      },
    }))
    .filter(({ fill }) => !isEmptyFill(fill));

  if (planned.length === 0) {
    return { assetsFilled: 0, fieldsFilled: 0 };
  }

  await recordEvents(
    planned.flatMap(({ asset, fill }) => [
      ...(fill.categoryId !== undefined
        ? [
            {
              organizationId,
              actorUserId: userId,
              action: "ASSET_CATEGORY_CHANGED" as const,
              entityType: "ASSET" as const,
              entityId: asset.id,
              assetId: asset.id,
              field: "categoryId",
              fromValue: null,
              toValue: fill.categoryId,
              meta: { viaAssetModelDefault: model.id },
            },
          ]
        : []),
      ...(fill.valuation !== undefined
        ? [
            {
              organizationId,
              actorUserId: userId,
              action: "ASSET_VALUATION_CHANGED" as const,
              entityType: "ASSET" as const,
              entityId: asset.id,
              assetId: asset.id,
              field: "valuation",
              fromValue: null,
              toValue: fill.valuation,
              meta: { viaAssetModelDefault: model.id },
            },
          ]
        : []),
      ...fill.customFields.map((fieldDefault) => ({
        organizationId,
        actorUserId: userId,
        action: "ASSET_CUSTOM_FIELD_CHANGED" as const,
        entityType: "ASSET" as const,
        entityId: asset.id,
        assetId: asset.id,
        field: fieldDefault.customField.name,
        fromValue: null,
        toValue: defaultValueToFormString(fieldDefault.value),
        meta: { isFirstTimeSet: true, viaAssetModelDefault: model.id },
      })),
    ]),
    tx
  );

  /**
   * One note per asset. Assets filled with the same fields share the same
   * sentence, so they are grouped into one `createMany` per distinct note.
   */
  const assetIdsByNote = new Map<string, string[]>();
  for (const { asset, fill } of planned) {
    const parts: string[] = [];
    if (fill.categoryId !== undefined) {
      parts.push(`category ${wrapCategoryForNote(category)}`);
    }
    if (fill.valuation !== undefined) {
      parts.push(
        `value **${formatCurrencyForNote({
          value: fill.valuation,
          currency,
          locale,
        })}**`
      );
    }
    for (const fieldDefault of fill.customFields) {
      parts.push(
        `**${stripMarkdocDelimiters(
          fieldDefault.customField.name
        )}** **${noteValueText(fieldDefault.value)}**`
      );
    }
    const content = buildModelDefaultsFillNote({ userLink, model, parts });
    const group = assetIdsByNote.get(content);
    if (group) {
      group.push(asset.id);
    } else {
      assetIdsByNote.set(content, [asset.id]);
    }
  }
  for (const [content, noteAssetIds] of assetIdsByNote) {
    await createNotes(
      {
        content,
        type: "UPDATE",
        userId,
        assetIds: noteAssetIds,
        organizationId,
      },
      tx
    );
  }

  return {
    assetsFilled: planned.length,
    fieldsFilled: planned.reduce(
      (sum, { fill }) =>
        sum +
        fill.customFields.length +
        (fill.categoryId !== undefined ? 1 : 0) +
        (fill.valuation !== undefined ? 1 : 0),
      0
    ),
  };
}

/** How many of a model's linked assets have empty fields it would fill. */
export type LinkedAssetsFillSummary = {
  /** Linked, unarchived assets with at least one field to fill. */
  assetCount: number;
  /** Per field, how many of those assets it would fill. */
  fields: { label: string; count: number }[];
};

/**
 * Whether a model holds any default it could fill: a category, a valuation
 * or a usable custom field default.
 *
 * @param model - The model's defaults
 */
export function modelHasFillableDefaults(model: AssetModelDefaults) {
  return (
    model.defaultCategoryId !== null ||
    model.defaultValuation !== null ||
    model.customFieldDefaults.some(isUsableFieldDefault)
  );
}

/**
 * Summarises what "fill linked assets" would do, for the model edit page.
 *
 * A default category missing from the organization fills nothing, exactly as
 * in `applyAssetModelDefaultsToAssets`.
 *
 * @param params.model - The model's defaults
 * @param params.organizationId - Caller's organization
 * @returns Counts of assets and fields the fill would change
 */
export async function getLinkedAssetsFillSummary({
  model,
  organizationId,
}: {
  model: AssetModelDefaults;
  organizationId: Organization["id"];
}): Promise<LinkedAssetsFillSummary> {
  if (!modelHasFillableDefaults(model)) {
    return { assetCount: 0, fields: [] };
  }

  const category = await findModelDefaultCategory(db, {
    defaultCategoryId: model.defaultCategoryId,
    organizationId,
  });
  const fillableModel = { ...model, defaultCategoryId: category?.id ?? null };
  if (!modelHasFillableDefaults(fillableModel)) {
    return { assetCount: 0, fields: [] };
  }

  const assets = await db.asset.findMany({
    where: { assetModelId: model.id, organizationId, archivedAt: null },
    select: {
      categoryId: true,
      valuation: true,
      customFields: {
        where: {
          customFieldId: {
            in: model.customFieldDefaults.map((d) => d.customFieldId),
          },
        },
        select: { customFieldId: true },
      },
    },
  });

  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  let assetCount = 0;

  for (const asset of assets) {
    const fill = planModelDefaultFill({
      model: fillableModel,
      current: {
        categoryId: asset.categoryId,
        valuation: asset.valuation,
        customFieldIdsWithValue: new Set(
          asset.customFields.map((value) => value.customFieldId)
        ),
      },
    });
    if (isEmptyFill(fill)) continue;
    assetCount += 1;
    if (fill.categoryId !== undefined) bump("Category");
    if (fill.valuation !== undefined) bump("Valuation");
    for (const fieldDefault of fill.customFields) {
      bump(fieldDefault.customField.name);
    }
  }

  return {
    assetCount,
    fields: [...counts].map(([fieldLabel, count]) => ({
      label: fieldLabel,
      count,
    })),
  };
}

/** One custom field default as submitted by the model form. */
export type SubmittedFieldDefault = {
  customFieldId: string;
  /** The value to store, or `undefined` to clear the default. */
  value: ICustomFieldValueJson | undefined;
};

/**
 * Replaces a model's custom field defaults with the submitted ones.
 *
 * Only fields of this organization, of a type a model can default, are
 * accepted; anything else in the submission is refused with a 400.
 *
 * @param params.assetModelId - The model (already org-validated by the caller)
 * @param params.organizationId - Caller's organization
 * @param params.defaults - One entry per field shown on the form
 * @param tx - Optional transaction client
 * @throws {ShelfError} 400 when a field is not in this organization or of an
 *   unsupported type
 */
export async function saveAssetModelCustomFieldDefaults(
  {
    assetModelId,
    organizationId,
    defaults,
  }: {
    assetModelId: string;
    organizationId: Organization["id"];
    defaults: SubmittedFieldDefault[];
  },
  tx: ModelDefaultsTxClient = db
) {
  if (defaults.length === 0) {
    return;
  }

  const fieldIds = defaults.map((d) => d.customFieldId);
  const fields: Pick<CustomField, "id" | "type">[] =
    await tx.customField.findMany({
      where: { id: { in: fieldIds }, organizationId, deletedAt: null },
      select: { id: true, type: true },
    });
  const allowed = new Set(
    fields
      .filter((field) => MODEL_DEFAULT_FIELD_TYPES.includes(field.type))
      .map((field) => field.id)
  );

  if (fieldIds.some((id) => !allowed.has(id))) {
    throw new ShelfError({
      cause: null,
      title: "Custom field not allowed",
      message:
        "One of the custom fields can't have a default on an asset model. Reload the page and try again.",
      additionalData: { assetModelId, organizationId, fieldIds },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const toClear = defaults
    .filter((d) => d.value === undefined)
    .map((d) => d.customFieldId);
  if (toClear.length > 0) {
    await tx.assetModelCustomFieldDefault.deleteMany({
      where: { assetModelId, customFieldId: { in: toClear } },
    });
  }

  for (const fieldDefault of defaults) {
    if (fieldDefault.value === undefined) continue;
    const value = fieldDefault.value as unknown as object;
    await tx.assetModelCustomFieldDefault.upsert({
      where: {
        assetModelId_customFieldId: {
          assetModelId,
          customFieldId: fieldDefault.customFieldId,
        },
      },
      create: {
        assetModelId,
        customFieldId: fieldDefault.customFieldId,
        value,
      },
      update: { value },
    });
  }
}

/** A custom field the model form offers a default for. */
export type ModelDefaultFieldOption = Pick<
  CustomField,
  "id" | "name" | "type" | "format" | "helpText" | "options"
> & {
  /** Categories the field is limited to; empty means every category. */
  categories: { id: string; name: string }[];
};

/**
 * Lists the custom fields a model can hold a default for: active, not
 * deleted, of a supported type. Fields limited to categories are included,
 * because a model's assets can sit in any category.
 *
 * @param params.organizationId - Caller's organization
 * @returns The fields, in creation order
 */
export async function getModelDefaultFieldOptions({
  organizationId,
}: {
  organizationId: Organization["id"];
}): Promise<ModelDefaultFieldOption[]> {
  return db.customField.findMany({
    where: {
      organizationId,
      active: true,
      deletedAt: null,
      type: { in: [...MODEL_DEFAULT_FIELD_TYPES] },
    },
    select: {
      id: true,
      name: true,
      type: true,
      format: true,
      helpText: true,
      options: true,
      categories: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Reads the model form's custom field defaults (`cf-<id>` inputs).
 *
 * Only fields whose input is present in the form are read, so a form that
 * does not render the section (the inline "new model" dialog) never clears
 * existing defaults. Values are validated with the same schema the asset form
 * uses, with every field optional.
 *
 * @param params.formData - The submitted model form
 * @param params.fields - The fields the form offered
 * @returns One entry per submitted field; `value` is `undefined` when blank
 * @throws {ShelfError} 400 with per-field errors when a value is invalid
 */
export function parseModelDefaultsFromFormData({
  formData,
  fields,
}: {
  formData: FormData;
  fields: ModelDefaultFieldOption[];
}): SubmittedFieldDefault[] {
  const submitted = fields.filter((field) => formData.has(`cf-${field.id}`));
  if (submitted.length === 0) {
    return [];
  }

  const schema = mergedSchema({
    baseSchema: z.object({}),
    // Every default is optional. A Link field validates as a web link, like
    // on the asset form.
    customFields: submitted.map((field) =>
      toCustomFieldZodSchema({ ...field, required: false })
    ),
  });

  const payload = parseData(formData, schema);
  const values = extractCustomFieldValuesFromPayload({
    payload,
    customFieldDef: submitted as unknown as CustomField[],
  });

  return values.map((entry) => ({
    customFieldId: entry.id,
    value: entry.value ?? undefined,
  }));
}

/**
 * Fills the empty fields of every unarchived asset linked to a model.
 *
 * The explicit "fill linked assets" action on the model page. It never
 * overwrites a value, and records one note per asset plus one event per
 * filled field.
 *
 * @param params.assetModelId - The model
 * @param params.organizationId - Caller's organization
 * @param params.userId - The acting user
 * @param params.currency - Organization currency, for notes
 * @param params.locale - Request locale, for notes
 * @returns How many assets and fields were filled
 * @throws {ShelfError} 404 when the model is not in this organization
 */
export async function fillLinkedAssetsFromModel({
  assetModelId,
  organizationId,
  userId,
  currency,
  locale,
}: {
  assetModelId: string;
  organizationId: Organization["id"];
  userId: User["id"];
  currency: Currency;
  locale: string;
}) {
  const model = await getAssetModelDefaults({ assetModelId, organizationId });
  if (!model) {
    throw new ShelfError({
      cause: null,
      title: "Asset model not found",
      message: "This asset model does not exist in your workspace.",
      additionalData: { assetModelId, organizationId },
      label,
      status: 404,
      shouldBeCaptured: false,
    });
  }

  const linked = await db.asset.findMany({
    where: { assetModelId, organizationId, archivedAt: null },
    select: { id: true },
  });
  const assetIds = linked.map((asset) => asset.id);
  if (assetIds.length === 0) {
    return { assetsFilled: 0, fieldsFilled: 0 };
  }

  const userLink = await resolveUserLink({
    userId,
    loadUserForNotes: createLoadUserForNotes(userId),
  });

  return db.$transaction(
    async (tx) => {
      // Serialises with archiving: an asset archived meanwhile is frozen and
      // the re-read inside `applyAssetModelDefaultsToAssets` skips it.
      await lockAssetsForArchiveGuard(tx, assetIds, organizationId);
      return applyAssetModelDefaultsToAssets(tx, {
        organizationId,
        userId,
        userLink,
        model,
        assetIds,
        currency,
        locale,
      });
    },
    { timeout: 15000 }
  );
}
