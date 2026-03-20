import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/locations?orgId=xxx&search=yyy
 *
 * Returns all locations for the organization.
 * Used by the mobile app's location picker.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || "";

    const locations = await db.location.findMany({
      where: {
        organizationId,
        ...(search
          ? { name: { contains: search, mode: "insensitive" as const } }
          : {}),
      },
      select: {
        id: true,
        name: true,
        description: true,
        image: true,
        parentId: true,
      },
      orderBy: { name: "asc" },
      take: 50,
    });

    return data({ locations });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
