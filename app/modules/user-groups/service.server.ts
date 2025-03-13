import type { Group, Prisma } from "@prisma/client";
import { db } from "~/database/db.server";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { isLikeShelfError, ShelfError } from "~/utils/error";
import { getCurrentSearchParams } from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";

const label = "User Group";

export async function createNewGroup({
  name,
  organizationId,
  createdById,
}: Pick<Group, "name" | "organizationId" | "createdById">) {
  try {
    return await db.group.create({
      data: {
        name,
        organization: { connect: { id: organizationId } },
        createdBy: { connect: { id: createdById } },
      },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while creating group.",
      label,
    });
  }
}

export async function getPaginatedAndFilterableGroups({
  organizationId,
  request,
}: {
  organizationId: Group["organizationId"];
  request: Request;
}) {
  try {
    const searchParams = getCurrentSearchParams(request);
    const { page, perPageParam, search } = getParamsValues(searchParams);

    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const skip = page > 1 ? (page - 1) * perPage : 0;
    const take = perPage >= 1 && perPage <= 100 ? perPage : 20;

    const where: Prisma.GroupWhereInput = { organizationId };

    if (search) {
      const searchTerm = search.toLowerCase().trim();
      where.name = { contains: searchTerm, mode: "insensitive" };
    }

    const [groups, totalGroups] = await Promise.all([
      db.group.findMany({
        where,
        skip,
        take,
        include: {
          _count: { select: { teamMembers: true } },
        },
      }),
      db.group.count({ where }),
    ]);

    const totalPages = Math.ceil(totalGroups / perPageParam);

    return {
      groups,
      totalGroups,
      page,
      perPage,
      totalPages,
      search,
    };
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: "Something went wrong while getting groups.",
    });
  }
}

export async function deleteGroup({
  id,
  organizationId,
}: Pick<Group, "id" | "organizationId">) {
  try {
    const group = await db.group.findFirst({
      where: { id, organizationId },
      select: { id: true, _count: { select: { teamMembers: true } } },
    });

    // Make sure the group exists in the same organization
    if (!group) {
      throw new ShelfError({
        cause: null,
        label,
        message: "Group not found",
      });
    }

    // Make sure that user is deleting a group which does not have any members
    if (group._count.teamMembers > 0) {
      throw new ShelfError({
        cause: null,
        label,
        title: "Delete failed",
        message:
          "This group contain some team members. Please remove all team members to delete this group.",
      });
    }

    return await db.group.delete({
      where: { id: group.id },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while deleting the group.",
    });
  }
}

export async function getGroupById({
  id,
  organizationId,
}: Pick<Group, "id" | "organizationId">) {
  try {
    return await db.group.findFirst({
      where: { id, organizationId },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while getting group details.",
    });
  }
}

export async function updateGroup({
  id,
  organizationId,
  name,
}: Pick<Group, "id" | "organizationId" | "name">) {
  try {
    return await db.group.update({
      where: { id, organizationId },
      data: { name },
    });
  } catch (cause) {
    throw new ShelfError({
      cause,
      label,
      message: isLikeShelfError(cause)
        ? cause.message
        : "Something went wrong while updating group.",
    });
  }
}
