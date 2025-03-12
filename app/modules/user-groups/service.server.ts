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
