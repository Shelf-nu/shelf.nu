import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { createAsset } from "~/modules/asset/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * POST /api/mobile/asset/create
 *
 * Quick asset creation from mobile.
 * Only title is required. QR code is auto-generated.
 *
 * Body: {
 *   title: string (required, min 2 chars)
 *   description?: string
 *   categoryId?: string
 *   locationId?: string
 *   valuation?: number
 * }
 */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const body = await request.json();
    const { title, description, categoryId, locationId, valuation } = z
      .object({
        title: z.string().min(2, "Title must be at least 2 characters"),
        description: z.string().optional(),
        categoryId: z.string().optional(),
        locationId: z.string().optional(),
        valuation: z.number().optional(),
      })
      .parse(body);

    const asset = await createAsset({
      title,
      description: description || "",
      userId: user.id,
      organizationId,
      categoryId: categoryId || null,
      locationId: locationId || undefined,
      valuation: valuation ?? null,
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
