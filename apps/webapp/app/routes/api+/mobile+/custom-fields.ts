/**
 * Mobile Custom Fields API
 *
 * Endpoint backing the companion app's create/edit forms: returns the active
 * custom-field definitions the caller should render for the given category.
 *
 * Uses an explicit `select` so we never accidentally leak fields that aren't
 * meant for the client (e.g. `userId`, `organizationId`, `deletedAt`). If new
 * fields are added to the response, prefer extending the `select` here.
 *
 * @see {@link file://./../../../modules/custom-field/service.server.ts} — `getActiveCustomFields`
 * @see {@link file://../../../../../../packages/database/prisma/schema.prisma} — `CustomField` model
 */
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
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
 *
 * @param args - React Router loader args (carrying the incoming request).
 * @returns A JSON response with `{ customFields: [...] }` on success. Each
 *   entry exposes only the fields the mobile client needs (no userId /
 *   organizationId / deletedAt). On failure, returns
 *   `{ error: { message } }` with an appropriate HTTP status.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const categoryIdRaw = url.searchParams.get("categoryId");
    const categoryId =
      categoryIdRaw && categoryIdRaw !== "uncategorized" ? categoryIdRaw : null;

    // why: prefer an explicit `select` over reusing `getActiveCustomFields`
    // (which returns the full row). This guarantees we never leak
    // organizationId / userId / deletedAt to the mobile client and keeps
    // the response schema close to the call site for easy auditing.
    const fields = await db.customField.findMany({
      where: {
        organizationId,
        active: { equals: true },
        deletedAt: null,
        ...(typeof categoryId === "string"
          ? {
              OR: [
                { categories: { none: {} } },
                { categories: { some: { id: categoryId } } },
              ],
            }
          : { categories: { none: {} } }),
      },
      select: {
        id: true,
        name: true,
        type: true,
        helpText: true,
        required: true,
        options: true,
        updatedAt: true,
      },
    });

    return data({
      customFields: fields.map((cf) => ({
        id: cf.id,
        name: cf.name,
        type: cf.type,
        helpText: cf.helpText,
        required: cf.required,
        // why: `options` is only meaningful for OPTION fields per the schema
        // contract (non-nullable String[] but empty for other types). Hide it
        // for non-OPTION fields so mobile clients don't render empty pickers.
        options: cf.type === "OPTION" ? cf.options : undefined,
        updatedAt: cf.updatedAt.toISOString(),
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
