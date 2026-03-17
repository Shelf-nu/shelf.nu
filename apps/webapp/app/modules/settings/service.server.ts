import { InviteStatuses } from "@prisma/client";
import type { Organization, OrganizationRoles } from "@prisma/client";

import type { LoaderFunctionArgs } from "react-router";
import { sbDb } from "~/database/supabase.server";
import {
  organizationRolesMap,
  type UserFriendlyRoles,
} from "~/routes/_layout+/settings.team";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";

const label = "Settings";

export interface TeamMembersWithUserOrInvite {
  id: string;
  name: string;
  img: string;
  email: string;
  status: InviteStatuses;
  role: UserFriendlyRoles;
  roleEnum: OrganizationRoles;
  userId: string | null;
  sso: boolean;
  custodies?: number;
  inviteMessage?: string | null;
}

export async function getPaginatedAndFilterableSettingUsers({
  organizationId,
  request,
}: {
  organizationId: Organization["id"];
  request: LoaderFunctionArgs["request"];
}) {
  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);

  const { page, perPageParam, search } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    /**
     * We need to:
     * 1. Get UserOrganization rows for this org
     * 2. Join with User data
     * 3. For each user, get their TeamMember custody count
     *
     * Supabase PostgREST supports foreign-key joins via embedded resources.
     * UserOrganization.userId -> User.id
     */
    let query = sbDb
      .from("UserOrganization")
      .select("roles, user:User!inner(*)", { count: "exact" })
      .eq("organizationId", organizationId);

    if (search) {
      query = query.or(
        `firstName.ilike.%${search}%,lastName.ilike.%${search}%,email.ilike.%${search}%`,
        { referencedTable: "User" }
      );
    }

    const {
      data: userOrgs,
      count: totalItems,
      error: userOrgsError,
    } = await query.range(skip, skip + take - 1);

    if (userOrgsError) throw userOrgsError;

    const userIds = (userOrgs ?? []).map(
      (uo) =>
        (
          uo.user as unknown as {
            id: string;
            firstName: string | null;
            lastName: string | null;
            profilePicture: string | null;
            email: string;
            sso: boolean;
          }
        ).id
    );

    /**
     * Get team members for these users in this org so we can count custodies.
     * TeamMember.userId -> User.id, filtered by organizationId.
     */
    let custodyMap: Record<string, number> = {};
    if (userIds.length > 0) {
      const { data: teamMembers, error: tmError } = await sbDb
        .from("TeamMember")
        .select("userId, custodies:Custody(id)")
        .eq("organizationId", organizationId)
        .in("userId", userIds);

      if (tmError) throw tmError;

      for (const tm of teamMembers ?? []) {
        if (tm.userId) {
          custodyMap[tm.userId] = Array.isArray(tm.custodies)
            ? tm.custodies.length
            : 0;
        }
      }
    }

    /**
     * Create a structure for the users org members and merge it with invites
     */
    type UserShape = {
      id: string;
      firstName: string | null;
      lastName: string | null;
      profilePicture: string | null;
      email: string;
      sso: boolean;
    };

    const teamMembersWithUserOrInvite: TeamMembersWithUserOrInvite[] = (
      userOrgs ?? []
    ).map((um) => {
      const user = um.user as unknown as UserShape;
      return {
        id: user.id,
        name: `${user.firstName ? user.firstName : ""} ${
          user.lastName ? user.lastName : ""
        }`,
        img: user.profilePicture ?? "/static/images/default_pfp.jpg",
        email: user.email,
        status: "ACCEPTED" as InviteStatuses,
        role: organizationRolesMap[um.roles[0]],
        roleEnum: um.roles[0],
        userId: user.id,
        sso: user.sso,
        custodies: custodyMap[user.id] ?? 0,
      };
    });

    const totalPages = Math.ceil((totalItems ?? 0) / perPage);

    return {
      page,
      perPage,
      totalPages,
      search,
      items: teamMembersWithUserOrInvite,
      totalItems: totalItems ?? 0,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting registered users",
      additionalData: { organizationId },
      label,
    });
  }
}

export async function getPaginatedAndFilterableSettingTeamMembers({
  organizationId,
  request,
}: {
  organizationId: Organization["id"];
  request: LoaderFunctionArgs["request"];
}) {
  const searchParams = getCurrentSearchParams(request);
  const paramsValues = getParamsValues(searchParams);

  const { page, perPageParam, search } = paramsValues;

  const cookie = await updateCookieWithPerPage(request, perPageParam);
  const { perPage } = cookie;

  try {
    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 200;

    /**
     * We need TeamMembers that:
     * 1. Are not deleted (deletedAt is null)
     * 2. Belong to this org
     * 3. Have no linked user (userId is null) — these are non-user team members
     * 4. Do NOT have any pending invites
     *
     * We also need custody counts.
     */

    /** First, get IDs of team members with pending invites so we can exclude them */
    const { data: pendingInvites, error: inviteError } = await sbDb
      .from("Invite")
      .select("teamMemberId")
      .eq("organizationId", organizationId)
      .eq("status", InviteStatuses.PENDING);

    if (inviteError) throw inviteError;

    const pendingTeamMemberIds = (pendingInvites ?? []).map(
      (inv) => inv.teamMemberId
    );

    let query = sbDb
      .from("TeamMember")
      .select("*, custodies:Custody(id)", { count: "exact" })
      .is("deletedAt", null)
      .eq("organizationId", organizationId)
      .is("userId", null);

    /** Exclude team members with pending invites */
    if (pendingTeamMemberIds.length > 0) {
      query = query.not("id", "in", `(${pendingTeamMemberIds.join(",")})`);
    }

    if (search) {
      query = query.ilike("name", `%${search}%`);
    }

    const {
      data: teamMembers,
      count: totalTeamMembers,
      error: tmError,
    } = await query.range(skip, skip + take - 1);

    if (tmError) throw tmError;

    const totalPages = Math.ceil((totalTeamMembers ?? 0) / perPage);

    /**
     * Map team members to include custody count as `_count.custodies`
     * to match the shape expected by consumers.
     */
    const teamMembersWithCount = (teamMembers ?? []).map((tm) => ({
      ...tm,
      _count: {
        custodies: Array.isArray(tm.custodies) ? tm.custodies.length : 0,
      },
    }));

    return {
      page,
      perPage,
      totalPages,
      search,
      totalTeamMembers: totalTeamMembers ?? 0,
      teamMembers: teamMembersWithCount,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Something went wrong while getting team members",
      additionalData: { organizationId },
      label,
    });
  }
}
