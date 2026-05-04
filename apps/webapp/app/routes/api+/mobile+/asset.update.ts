import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
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
 *   customFields?: { id: string; value: any }[] (custom field updates)
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
              value: z.any(),
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
      const customFieldDef = await getActiveCustomFields({
        organizationId,
        category: categoryId ?? null,
      });

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
