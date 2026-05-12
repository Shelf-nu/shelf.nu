import { data, type LoaderFunctionArgs } from "react-router";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { getActiveCustomFields } from "~/modules/custom-field/service.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/custom-fields?orgId=X&categoryId=Y
 *
 * Returns the active custom field definitions for the organization,
 * optionally filtered to those that apply to `categoryId`. The mobile
 * create screen calls this when the user picks a category so it can
 * render the right inputs (including required indicators).
 *
 * `categoryId` may be omitted or set to "uncategorized" to fetch only
 * fields that apply to assets with no category.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const categoryIdRaw = url.searchParams.get("categoryId");
    const categoryId =
      categoryIdRaw && categoryIdRaw !== "uncategorized" ? categoryIdRaw : null;

    const fields = await getActiveCustomFields({
      organizationId,
      category: categoryId,
    });

    return data({
      customFields: fields.map((cf) => ({
        id: cf.id,
        name: cf.name,
        type: cf.type,
        helpText: cf.helpText,
        required: cf.required,
        options: cf.options ?? null,
      })),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
