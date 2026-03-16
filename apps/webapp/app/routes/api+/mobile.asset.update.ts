import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { updateAsset } from "~/modules/asset/service.server";
import type { ShelfAssetCustomFieldValueType } from "~/modules/asset/types";
import { makeShelfError } from "~/utils/error";

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

    // Transform custom fields into the format updateAsset expects
    let customFieldsValues: ShelfAssetCustomFieldValueType[] | undefined;
    if (customFields && customFields.length > 0) {
      customFieldsValues = customFields.map((cf) => ({
        id: cf.id,
        value: cf.value,
      })) as unknown as ShelfAssetCustomFieldValueType[];
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
