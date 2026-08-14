import { OrganizationRoles } from "@prisma/client";
import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/team-members?orgId=xxx
 *
 * Returns non-deleted team members for the organization.
 * Used by the mobile app's custody assignment picker.
 *
 * SELF_SERVICE callers only receive their own team member record — they may
 * only assign custody to themselves (enforced again in the custody services),
 * and the web scanner loader applies the same filter (`filterByUserId`), so
 * the full roster is never exposed to them on either platform.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { role } = await getMobileUserContext(user.id, organizationId);
    const isSelfService = role === OrganizationRoles.SELF_SERVICE;

    const url = new URL(request.url);
    const search = url.searchParams.get("search") || "";

    /**
     * Pagination. Custody has to be assignable to ANY colleague, not just the
     * first page of them — an org larger than one page could not hand an asset
     * to the people past the cut, and search only helps if you already know
     * the name. Defaults keep older clients unchanged: no params means page 1.
     */
    const page = Math.max(
      1,
      parseInt(url.searchParams.get("page") || "1", 10) || 1
    );
    const perPage = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get("perPage") || "50", 10) || 50)
    );

    const where = {
      organizationId,
      deletedAt: null,
      ...(isSelfService ? { userId: user.id } : {}),
      ...(search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : {}),
    };

    const [teamMembers, totalCount] = await Promise.all([
      db.teamMember.findMany({
        where,
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
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      db.teamMember.count({ where }),
    ]);

    return data({
      teamMembers,
      page,
      perPage,
      totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / perPage)),
    });
  } catch (cause) {
    const reason = makeShelfError(cause);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
