import { data, type LoaderFunctionArgs } from "react-router";
import { db } from "~/database/db.server";
import {
  getMobileUserContext,
  requireMobileAuth,
  requireOrganizationAccess,
} from "~/modules/api/mobile-auth.server";
import { resolveCustodianPickerScope } from "~/modules/team-member/service.server";
import { resolveMostPrivilegedRole } from "~/utils/booking-authorization.server";
import { makeShelfError } from "~/utils/error";

/**
 * GET /api/mobile/team-members?orgId=xxx
 *
 * Returns non-deleted team members for the organization.
 * Used by the mobile app's custody assignment picker.
 *
 * Every companion caller is an ASSIGNMENT picker: asset custody, kit custody,
 * the scanner's bulk-assign sheet, and the booking custodian on create/edit.
 * The scope therefore comes from `resolveCustodianPickerScope`, the same rule
 * the web pickers resolve through, so the two platforms offer the same names.
 *
 * `booking-custodian` is the widest purpose this endpoint serves, and the one
 * it must answer for: BASE holds `booking:create` and has to be able to put
 * itself on a booking. Restricted roles get their own row and nothing else;
 * ADMIN and OWNER get the roster. A caller who may not actually take asset
 * custody is still refused by the custody services, which gate on the
 * permission matrix rather than on this list.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const organizationId = await requireOrganizationAccess(request, user.id);
    const { roles, canSeeAllCustody } = await getMobileUserContext(
      user.id,
      organizationId
    );
    // Resolved from the whole membership, not `roles[0]`: a membership ordered
    // [SELF_SERVICE, ADMIN] reads as SELF_SERVICE by position, which narrows a
    // genuine admin to their own row.
    const scope = resolveCustodianPickerScope({
      purpose: "booking-custodian",
      role: resolveMostPrivilegedRole(roles),
      canSeeAllCustody,
      userId: user.id,
    });

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
      // `self` narrows to the caller's own team-member rows. `none` cannot
      // arise from `booking-custodian`, but is handled so a future purpose
      // cannot silently widen this to the whole roster.
      ...(scope.mode === "self" ? { userId: scope.userId } : {}),
      ...(search
        ? { name: { contains: search, mode: "insensitive" as const } }
        : {}),
    };

    if (scope.mode === "none") {
      return data({
        teamMembers: [],
        page,
        perPage,
        totalCount: 0,
        totalPages: 1,
      });
    }

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
              displayName: true,
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
