import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/team-members?orgId=xxx
 *
 * Returns all non-deleted team members for the organization.
 * Used by the mobile app's custody assignment picker.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || "";

    const teamMembers = await db.teamMember.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(search
          ? { name: { contains: search, mode: "insensitive" as const } }
          : {}),
      },
      select: {
        id: true,
        name: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profilePicture: true,
          },
        },
      },
      orderBy: [
        // Users (those with a linked user account) come first
        { userId: "asc" },
        { name: "asc" },
      ],
      take: 50,
    });

    return data({ teamMembers });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
