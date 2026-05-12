/**
 * Mobile Asset Update API
 *
 * Endpoint backing the companion app's edit/update flow. Updates are partial:
 * only fields included in the request body are changed. When custom fields
 * are part of the patch we enforce two invariants that mirror the webapp:
 *
 * 1. Required custom fields cannot be explicitly cleared (null / empty string).
 * 2. Submitted custom-field ids must belong to the org's active definitions
 *    for the asset's category — unknown ids are rejected with HTTP 400.
 *
 * For category resolution we prefer the body's `categoryId` (the caller is
 * actively changing the category) and fall back to the asset's persisted
 * `categoryId` so we validate against the right set of definitions.
 *
 * @see {@link file://./../../../utils/custom-fields.ts} — `buildCustomFieldValue`, `extractCustomFieldValuesFromPayload`
 * @see {@link file://./../../../modules/custom-field/service.server.ts} — `getActiveCustomFields`
 * @see {@link file://./../../../modules/asset/service.server.ts} — `updateAsset`
 */
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { updateAsset } from "~/modules/asset/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { extractCustomFieldValuesFromPayload } from "~/utils/custom-fields";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/asset/update
 *
 * Update an existing asset from mobile.
 * All fields except assetId are optional — only provided fields are updated.
 *
 * Body: {
 *   assetId: string (required)
 *   title?: string (min 2 chars)
 *   description?: string
 *   categoryId?: string | "uncategorized" (pass "uncategorized" to clear)
 *   newLocationId?: string (pass "" to clear)
 *   currentLocationId?: string (needed to detect location change)
 *   valuation?: number | null (pass null to clear)
 *   customFields?: { id: string; value: string | number | boolean | null }[]
 * }
 *
 * @param args - React Router action args (carrying the incoming request).
 * @returns A JSON response with the updated asset's id/title/description on
 *   success, or `{ error: { message } }` with an appropriate HTTP status on
 *   failure:
 *   - 400 Unknown custom field id / attempt to clear required field
 *   - 404 Asset not found in the caller's organization
 *   - 401/403 Auth or permission errors (surfaced by `requireMobileAuth` /
 *     `requireMobilePermission`)
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.update,
    });

    const body = await request.json();
    const {
      assetId,
      title,
      description,
      categoryId,
      newLocationId,
      currentLocationId,
      valuation,
      customFields,
    } = z
      .object({
        assetId: z.string().min(1, "Asset ID is required"),
        title: z
          .string()
          .min(2, "Title must be at least 2 characters")
          .optional(),
        description: z.string().optional(),
        categoryId: z.string().optional(),
        newLocationId: z.string().optional(),
        currentLocationId: z.string().optional(),
        valuation: z.number().nullable().optional(),
        customFields: z
          .array(
            z.object({
              id: z.string(),
              value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
            })
          )
          .optional(),
      })
      .parse(body);

    // why: validate custom-field values against the org's active definitions.
    // Bypassing this lets a mobile client smuggle arbitrary JSON (or values
    // that don't match the field's declared type) into the asset record.
    // Mirrors how the webapp edit form processes form data.
    let customFieldsValues;
    if (customFields && customFields.length > 0) {
      // why: if the caller didn't supply categoryId but is updating custom
      // fields, we MUST validate against the asset's persisted category —
      // otherwise we'd resolve definitions for "uncategorized" and either
      // miss required fields or reject legitimate values. Fetching here also
      // doubles as the cross-org existence check (returns 404 if the asset
      // isn't visible to the caller's organization).
      let effectiveCategoryId: string | null = categoryId ?? null;
      if (categoryId === undefined) {
        const existing = await db.asset.findUnique({
          where: { id: assetId, organizationId },
          select: { categoryId: true },
        });
        if (!existing) {
          return data(
            { error: { message: "Asset not found" } },
            { status: 404 }
          );
        }
        effectiveCategoryId = existing.categoryId;
      }

      const customFieldDef = await getActiveCustomFields({
        organizationId,
        category: effectiveCategoryId,
      });

      const defById = new Map(customFieldDef.map((def) => [def.id, def]));

      // why: reject unknown ids up front. extractCustomFieldValuesFromPayload
      // would otherwise throw deep in buildCustomFieldValue when it
      // dereferences a missing definition.
      const unknown = customFields.find((cf) => !defById.has(cf.id));
      if (unknown) {
        return data(
          {
            error: {
              message: `Unknown custom field id: ${unknown.id}`,
            },
          },
          { status: 400 }
        );
      }

      // why: reject attempts to explicitly clear a required custom field on
      // update. We can't enforce "every required field has a value" here
      // because update is partial — the caller may only be touching some
      // fields. But if they EXPLICITLY send null/""/whitespace for a
      // required field, that's a contract violation we should block
      // server-side.
      const violatedRequired: string[] = [];
      for (const def of customFieldDef) {
        if (!def.required) continue;
        const submitted = customFields.find((cf) => cf.id === def.id);
        if (
          submitted !== undefined &&
          (submitted.value === null ||
            (typeof submitted.value === "string" &&
              submitted.value.trim() === ""))
        ) {
          violatedRequired.push(def.name);
        }
      }
      if (violatedRequired.length > 0) {
        return data(
          {
            error: {
              message: `Cannot clear required custom field${
                violatedRequired.length === 1 ? "" : "s"
              }: ${violatedRequired.join(", ")}`,
            },
          },
          { status: 400 }
        );
      }

      // The helper expects a flat object with cf-{id} keys (form-data shape).
      // Reshape the mobile array into that contract.
      // why: `CustomFieldInput` on the companion side emits "true"/"false"
      // strings for booleans, but `buildCustomFieldValue` only recognises
      // "yes"/"no" (or real booleans). Normalise here so the pipeline matches
      // the webapp form's contract.
      const cfPayload = Object.fromEntries(
        customFields.map((cf) => {
          const def = defById.get(cf.id);
          let value = cf.value;
          if (def?.type === "BOOLEAN") {
            if (value === true || value === "true") {
              value = true;
            } else if (value === false || value === "false") {
              value = false;
            }
          }
          return [`cf-${cf.id}`, value];
        })
      );

      customFieldsValues = extractCustomFieldValuesFromPayload({
        payload: cfPayload,
        customFieldDef,
      });
    }

    const asset = await updateAsset({
      id: assetId,
      userId: user.id,
      organizationId,
      request,
      title,
      description,
      categoryId,
      newLocationId: newLocationId || undefined,
      currentLocationId: currentLocationId || undefined,
      valuation: valuation !== undefined ? valuation : undefined,
      customFieldsValues,
    });

    return data({
      asset: {
        id: asset.id,
        title: asset.title,
        description: asset.description,
      },
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
