/**
 * Bulk "Set custom field" on the asset index.
 *
 * Sets one custom field to one value on many assets at once, the way bulk
 * category, location and tags already work. Two modes:
 *
 * - **Only empty fields** (the default): fills the assets that have no value
 *   for the field and leaves every value an asset already has alone.
 * - **Replace all**: writes the value on every selected asset.
 *
 * A field limited to certain categories is skipped on assets in other
 * categories, the same rule the asset form follows. Archived assets are
 * frozen and refused. Every asset that changes gets the note and the
 * `ASSET_CUSTOM_FIELD_CHANGED` event a single edit of the field would write.
 *
 * @see {@link file://./../../routes/api+/assets.bulk-update-custom-field.ts}
 * @see {@link file://./../../components/assets/bulk-custom-field-update-dialog.tsx}
 */
import type {
  Asset,
  AssetIndexSettings,
  CustomField,
  Organization,
  User,
} from "@prisma/client";
import { z } from "zod";
import { db } from "~/database/db.server";
import { recordEvents } from "~/modules/activity-event/service.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { buildCustomFieldValue, mergedSchema } from "~/utils/custom-fields";
import type { ErrorLabel } from "~/utils/error";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { parseData } from "~/utils/http.server";
import {
  assertAssetsAreNotArchived,
  assertAssetsBelongToOrg,
} from "~/utils/org-validation.server";
import { lockAssetsForArchiveGuard } from "./archive-lock.server";
import { resolveAssetIdsForBulkOperation } from "./bulk-operations-helper.server";
import type { LastAuditDateAccess } from "./last-audit-date-access";
import type { BookableListScope } from "./list-scope.server";
import type { ICustomFieldValueJson } from "./types";
import {
  detectCustomFieldChanges,
  getCustomFieldUpdateNoteContent,
} from "./utils.server";

const label: ErrorLabel = "Assets";

/** How the bulk action treats assets that already have a value. */
export const BULK_CUSTOM_FIELD_MODES = ["EMPTY_ONLY", "REPLACE"] as const;
export type BulkCustomFieldMode = (typeof BULK_CUSTOM_FIELD_MODES)[number];

/** A custom field the bulk action can set, as the dialog lists it. */
export type BulkSettableCustomField = Pick<
  CustomField,
  "id" | "name" | "type" | "options" | "helpText"
> & {
  /** Categories the field is limited to; empty means every category. */
  categories: { id: string; name: string }[];
};

/**
 * Lists the custom fields the bulk action can set: active and not deleted.
 *
 * @param params.organizationId - Caller's organization
 * @returns The fields, in creation order
 */
export async function getBulkSettableCustomFields({
  organizationId,
}: {
  organizationId: Organization["id"];
}): Promise<BulkSettableCustomField[]> {
  return db.customField.findMany({
    where: { organizationId, active: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      type: true,
      options: true,
      helpText: true,
      categories: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** What the bulk action did, for an honest toast. */
export type BulkSetCustomFieldResult = {
  /** Assets the selection resolved to. */
  resolved: number;
  /** Assets whose value changed. */
  changed: number;
  /** Assets left alone because they already had a value (only-empty mode). */
  skippedWithValue: number;
  /** Assets left alone because the field does not apply to their category. */
  skippedCategory: number;
};

/**
 * Validates a raw value against the field, exactly like the asset form does,
 * and builds the stored value.
 *
 * @throws {ShelfError} 400 when the value is blank or does not fit the field
 */
function buildValueForField(
  field: Pick<CustomField, "id" | "name" | "type" | "options" | "helpText">,
  raw: string
): ICustomFieldValueJson {
  // The form posts a yes/no answer as `on` or `off`; the shared schema reads
  // anything but `on` as "No", so a missing answer is refused here instead.
  if (field.type === "BOOLEAN" && raw !== "on" && raw !== "off") {
    throw new ShelfError({
      cause: null,
      title: "Pick Yes or No",
      message: `Pick Yes or No for ${field.name}.`,
      additionalData: { customFieldId: field.id },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  const key = `cf-${field.id}`;
  const schema = mergedSchema({
    baseSchema: z.object({}),
    customFields: [
      {
        id: field.id,
        // Shown in the error message ("Brand is required"), so the real name.
        name: field.name,
        helpText: field.helpText || "",
        // A yes/no field always has an answer, so it is never "required".
        required: field.type !== "BOOLEAN",
        type: field.type.toLowerCase() as "text",
        options: field.options,
      },
    ],
  });

  // A value that does not fit is the user's typo, not an incident to report.
  const payload = parseData({ [key]: raw }, schema, {
    shouldBeCaptured: false,
  }) as Record<string, unknown>;
  const built = buildCustomFieldValue(
    { raw: payload[key] as string },
    field as CustomField
  );

  if (!built) {
    throw new ShelfError({
      cause: null,
      title: "Enter a value",
      message: `Enter a value for ${field.name}.`,
      additionalData: { customFieldId: field.id },
      label,
      status: 400,
      shouldBeCaptured: false,
    });
  }

  return built;
}

/**
 * Sets one custom field to one value on many assets.
 *
 * @param params.assetIds - Selected ids, possibly the select-all key
 * @param params.customFieldId - The field, from form input (org-checked here)
 * @param params.rawValue - The value as the asset form would submit it
 * @param params.mode - Only empty fields, or replace every value
 * @param params.currentSearchParams - Live filters, for select-all
 * @param params.settings - Asset index settings, for select-all
 * @param params.lastAuditDateAccess - From `lastAuditDateAccessFor`
 * @param params.bookableScope - Caller's list scope, for select-all
 * @param params.timeZone - Acting user's timezone, for select-all date filters
 * @returns Counts of what changed and what was skipped, and why
 * @throws {ShelfError} 404 when the field is not in this organization, 400
 *   when the value does not fit the field or an asset is archived
 */
export async function bulkSetAssetCustomField({
  userId,
  organizationId,
  assetIds,
  customFieldId,
  rawValue,
  mode,
  currentSearchParams,
  settings,
  lastAuditDateAccess,
  bookableScope,
  timeZone = "UTC",
}: {
  userId: User["id"];
  organizationId: Organization["id"];
  assetIds: Asset["id"][];
  customFieldId: string;
  rawValue: string;
  mode: BulkCustomFieldMode;
  currentSearchParams?: string | null;
  settings: AssetIndexSettings;
  lastAuditDateAccess: LastAuditDateAccess;
  bookableScope: BookableListScope | null;
  timeZone?: string;
}): Promise<BulkSetCustomFieldResult> {
  try {
    // Org-scoped: a field id from another workspace reads as missing.
    const field = await db.customField.findFirst({
      where: {
        id: customFieldId,
        organizationId,
        active: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        type: true,
        options: true,
        helpText: true,
        categories: { select: { id: true } },
      },
    });
    if (!field) {
      throw new ShelfError({
        cause: null,
        title: "Custom field not found",
        message:
          "This custom field does not exist or is not active. Reload the page and try again.",
        additionalData: { customFieldId, organizationId },
        label,
        status: 404,
        shouldBeCaptured: false,
      });
    }

    const value = buildValueForField(field, rawValue);

    const resolvedIds = await resolveAssetIdsForBulkOperation({
      assetIds,
      organizationId,
      currentSearchParams,
      settings,
      // Reachable only with an asset write permission, which BASE and
      // SELF_SERVICE do not hold, so the custodian filter needs no narrowing.
      allowedTeamMemberIds: "all",
      lastAuditDateAccess,
      bookableScope,
      timeZone,
    });

    const empty: BulkSetCustomFieldResult = {
      resolved: 0,
      changed: 0,
      skippedWithValue: 0,
      skippedCategory: 0,
    };
    if (resolvedIds.length === 0) {
      return empty;
    }

    const user = await db.user.findFirst({
      where: { id: userId },
      select: USER_NAME_SELECT,
    });

    const fieldCategoryIds = new Set(field.categories.map((c) => c.id));
    const applies = (categoryId: string | null) =>
      fieldCategoryIds.size === 0 ||
      (categoryId !== null && fieldCategoryIds.has(categoryId));
    const fieldInfo = { id: field.id, name: field.name, type: field.type };

    // The read, the decision and the writes share one transaction, under the
    // lock archiving takes, so a value saved or an asset archived meanwhile
    // is seen before anything is written.
    return await db.$transaction(
      async (tx) => {
        await lockAssetsForArchiveGuard(tx, resolvedIds, organizationId);
        // A missing or foreign id refuses the whole request rather than
        // being dropped, so the toast never reports a partial selection.
        await assertAssetsBelongToOrg(
          { assetIds: resolvedIds, organizationId },
          tx
        );
        // Archived assets are frozen (issue #382): their fields cannot change.
        await assertAssetsAreNotArchived(
          { assetIds: resolvedIds, organizationId, actorUserId: userId },
          tx
        );

        // Org-scoped read: every id below is proven to belong here.
        const assets = await tx.asset.findMany({
          where: { id: { in: resolvedIds }, organizationId, archivedAt: null },
          select: {
            id: true,
            categoryId: true,
            customFields: {
              where: { customFieldId: field.id },
              select: { id: true, customFieldId: true, value: true },
            },
          },
        });

        let skippedWithValue = 0;
        let skippedCategory = 0;

        /** Assets that change, with the note-ready description of the change. */
        const changing = assets.flatMap((asset) => {
          if (!applies(asset.categoryId)) {
            skippedCategory += 1;
            return [];
          }
          const existing = asset.customFields[0];
          if (existing && mode === "EMPTY_ONLY") {
            skippedWithValue += 1;
            return [];
          }
          // Same comparison the single edit uses, so an identical value is a
          // no-op.
          const [change] = detectCustomFieldChanges(
            existing
              ? [
                  {
                    id: existing.id,
                    customFieldId: field.id,
                    value: existing.value as unknown as ICustomFieldValueJson,
                    customField: fieldInfo,
                  },
                ]
              : [],
            [{ id: field.id, value }],
            [fieldInfo]
          );
          return change ? [{ asset, existing, change }] : [];
        });

        const toCreate = changing.filter(({ existing }) => !existing);
        const toUpdate = changing.filter(({ existing }) => existing);

        if (toCreate.length > 0) {
          await tx.assetCustomFieldValue.createMany({
            data: toCreate.map(({ asset }) => ({
              assetId: asset.id,
              customFieldId: field.id,
              value: value as unknown as object,
            })),
          });
        }
        if (toUpdate.length > 0) {
          // By asset and field, so every stored row for the field gets the
          // value, not just the first.
          await tx.assetCustomFieldValue.updateMany({
            where: {
              assetId: { in: toUpdate.map(({ asset }) => asset.id) },
              customFieldId: field.id,
            },
            data: { value: value as unknown as object },
          });
        }
        if (changing.length > 0) {
          // A custom field is part of the asset, so its "Updated" time moves,
          // as it does when the field is edited on the asset form.
          await tx.asset.updateMany({
            where: {
              id: { in: changing.map(({ asset }) => asset.id) },
              organizationId,
            },
            data: { updatedAt: new Date() },
          });
        }

        // One event per asset, shaped like the single edit's event.
        await recordEvents(
          changing.map(({ asset, change }) => ({
            organizationId,
            actorUserId: userId,
            action: "ASSET_CUSTOM_FIELD_CHANGED" as const,
            entityType: "ASSET" as const,
            entityId: asset.id,
            assetId: asset.id,
            field: field.name,
            fromValue: change.previousValue ?? null,
            toValue: change.newValue ?? null,
            meta: { isFirstTimeSet: change.isFirstTimeSet, viaBulk: true },
          })),
          tx
        );

        // The single edit's note text, one row per asset, written in one
        // statement however many distinct previous values there are. The ids
        // come from the org-scoped read above, so no further org check runs.
        const notes = changing.flatMap(({ asset, change }) => {
          const content = getCustomFieldUpdateNoteContent({
            customFieldName: change.customFieldName,
            previousValue: change.previousValue,
            newValue: change.newValue,
            userId,
            firstName: user?.firstName ?? "",
            lastName: user?.lastName ?? "",
            displayName: user?.displayName,
            isFirstTimeSet: change.isFirstTimeSet,
          });
          return content
            ? [{ content, type: "UPDATE" as const, userId, assetId: asset.id }]
            : [];
        });
        if (notes.length > 0) {
          await tx.note.createMany({ data: notes });
        }

        return {
          resolved: assets.length,
          changed: changing.length,
          skippedWithValue,
          skippedCategory,
        };
      },
      // A select-all can span the workspace, like the other bulk writes.
      { timeout: 15000 }
    );
  } catch (cause) {
    // Keep a deliberate refusal's status and message (bad value, archived
    // assets, a field from another workspace).
    if (isLikeShelfError(cause)) throw cause;
    throw new ShelfError({
      cause,
      message: "Something went wrong while setting the custom field.",
      additionalData: { userId, organizationId, customFieldId },
      label,
    });
  }
}

/**
 * The toast text: what changed, then each reason an asset was left alone.
 * It reports what happened, never what was attempted.
 *
 * @param result - Counts from `bulkSetAssetCustomField`
 */
export function bulkCustomFieldMessage(result: BulkSetCustomFieldResult) {
  const assets = (n: number) => (n === 1 ? "1 asset" : `${n} assets`);
  const was = (n: number) => (n === 1 ? "was" : "were");
  const its = (n: number) => (n === 1 ? "its" : "their");
  const parts: string[] = [];

  if (result.resolved === 0) {
    return "Your selection no longer matches any assets.";
  }
  parts.push(
    result.changed > 0
      ? `Set on ${assets(result.changed)}.`
      : "No asset needed changing."
  );
  if (result.skippedWithValue > 0) {
    const n = result.skippedWithValue;
    parts.push(`${assets(n)} already had a value and ${was(n)} left alone.`);
  }
  if (result.skippedCategory > 0) {
    const n = result.skippedCategory;
    parts.push(
      `${assets(n)} ${was(n)} skipped because the field does not apply to ${its(
        n
      )} category.`
    );
  }
  return parts.join(" ");
}
