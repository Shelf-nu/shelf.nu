import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireMobilePermission,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createAsset } from "~/modules/asset/service.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { extractCustomFieldValuesFromPayload } from "~/utils/custom-fields";
import { makeShelfError } from "~/utils/error";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";

/**
 * POST /api/mobile/asset/create
 *
 * Quick asset creation from mobile.
 * Title is required. QR code is auto-generated. If the chosen category has
 * any custom fields with `required: true`, the caller MUST submit a value
 * for each — otherwise the request is rejected with HTTP 400 and the names
 * of the missing fields. Mirrors the webapp create form's contract.
 *
 * Body: {
 *   title: string (required, min 2 chars)
 *   description?: string
 *   categoryId?: string
 *   locationId?: string
 *   valuation?: number
 *   customFields?: { id: string; value: any }[]
 * }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    await requireMobilePermission({
      userId: user.id,
      organizationId,
      entity: PermissionEntity.asset,
      action: PermissionAction.create,
    });

    const body = await request.json();
    const {
      title,
      description,
      categoryId,
      locationId,
      valuation,
      customFields,
    } = z
      .object({
        title: z.string().min(2, "Title must be at least 2 characters"),
        description: z.string().optional(),
        categoryId: z.string().optional(),
        locationId: z.string().optional(),
        valuation: z.number().optional(),
        customFields: z
          .array(
            z.object({
              id: z.string(),
              value: z.any(),
            })
          )
          .optional(),
      })
      .parse(body);

    // why: every category may have its own set of required custom fields.
    // We always fetch the active definitions for the chosen category (or
    // for "no category" if none provided) so we can enforce required-ness
    // and coerce the submitted values against the canonical type/shape
    // before persisting. Mirrors the webapp create form's mergedSchema +
    // extractCustomFieldValuesFromPayload pipeline so mobile and web share
    // the same data-integrity guarantees.
    const customFieldDef = await getActiveCustomFields({
      organizationId,
      category: categoryId ?? null,
    });

    const submittedById = new Map(
      (customFields ?? []).map((cf) => [cf.id, cf.value])
    );
    const missingRequired: string[] = [];
    for (const def of customFieldDef) {
      if (!def.required) continue;
      const submitted = submittedById.get(def.id);
      if (submitted === undefined || submitted === null || submitted === "") {
        missingRequired.push(def.name);
      }
    }
    if (missingRequired.length > 0) {
      return data(
        {
          error: {
            message: `Missing required custom field${
              missingRequired.length === 1 ? "" : "s"
            }: ${missingRequired.join(", ")}`,
          },
        },
        { status: 400 }
      );
    }

    let customFieldsValues;
    if (customFields && customFields.length > 0) {
      // The helper expects a flat object with cf-{id} keys (form-data shape).
      // Reshape the mobile array into that contract.
      const cfPayload = Object.fromEntries(
        customFields.map((cf) => [`cf-${cf.id}`, cf.value])
      );
      customFieldsValues = extractCustomFieldValuesFromPayload({
        payload: cfPayload,
        customFieldDef,
      });
    }

    const asset = await createAsset({
      title,
      description: description || "",
      userId: user.id,
      organizationId,
      categoryId: categoryId || null,
      locationId: locationId || undefined,
      valuation: valuation ?? null,
      customFieldsValues,
    });

    return data({
      asset: {
        id: asset.id,
        title: asset.title,
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
