import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/categories
 *
 * Returns all categories for the organization (lightweight list for pickers).
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const categories = await db.category.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        color: true,
        _count: { select: { assets: true } },
      },
      orderBy: { name: "asc" },
    });

    return data({
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        assetCount: c._count.assets,
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
