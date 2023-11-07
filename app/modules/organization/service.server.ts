import { OrganizationRoles, OrganizationType } from "@prisma/client";
import type { Organization, Prisma, User } from "@prisma/client";

import type { LoaderFunctionArgs } from "@remix-run/node";
import { db } from "~/database";
import {
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import { defaultUserCategories } from "../category/default-categories";

export const getOrganization = async ({ id }: { id: Organization["id"] }) =>
  db.organization.findUnique({
    where: { id },
  });

export const getOrganizationByUserId = async ({
  userId,
  orgType,
}: {
  userId: User["id"];
  orgType: OrganizationType;
}) =>
  await db.organization.findFirstOrThrow({
    where: {
      owner: {
        is: {
          id: userId,
        },
      },
      type: orgType,
    },
    select: {
      id: true,
      name: true,
      type: true,
    },
  });

export type UserOrganization = Awaited<
  ReturnType<typeof getOrganizationByUserId>
>;

export const getUserOrganizationsWithDetailedData = async ({
  userId,
}: {
  userId: User["id"];
}) =>
  await db.organization.findMany({
    where: {
      owner: {
        is: {
          id: userId,
        },
      },
    },
    include: {
      _count: {
        select: {
          assets: true,
          members: true,
        },
      },
    },
  });

export async function createOrganization({
  name,
  userId,
  image,
}: Pick<Organization, "name"> & {
  userId: User["id"];
  image: File | null;
}) {
  const data = {
    name,
    type: OrganizationType.TEAM,
    categories: {
      create: defaultUserCategories.map((c) => ({ ...c, userId })),
    },
    userOrganizations: {
      create: {
        userId,
        roles: [OrganizationRoles.OWNER],
      },
    },
    owner: {
      connect: {
        id: userId,
      },
    },
  };

  const org = await db.organization.create({ data });
  if (image?.size && image?.size > 0) {
    await db.image.create({
      data: {
        blob: Buffer.from(await image.arrayBuffer()),
        contentType: image.type,
        ownerOrg: {
          connect: {
            id: org.id,
          },
        },
        organization: {
          connect: {
            id: org.id,
          },
        },
        user: {
          connect: {
            id: userId,
          },
        },
      },
    });
  }
  return org;
}
export async function updateOrganization({
  id,
  name,
  image,
  userId,
}: Pick<Organization, "name" | "id"> & {
  userId: User["id"];
  image: File | null;
}) {
  const data = {
    name,
  };

  if (image?.size && image?.size > 0) {
    const imageData = {
      blob: Buffer.from(await image.arrayBuffer()),
      contentType: image.type,
      ownerOrg: {
        connect: {
          id: id,
        },
      },
      user: {
        connect: {
          id: userId,
        },
      },
    };

    Object.assign(data, {
      image: {
        upsert: {
          create: imageData,
          update: imageData,
        },
      },
    });
  }

  return await db.organization.update({
    where: { id },
    data: data,
  });
}

export const getUserOrganizations = async ({ userId }: { userId: string }) => {
  const userOrganizations = await db.userOrganization.findMany({
    where: { userId },
    select: {
      organization: {
        select: { id: true, type: true, name: true, imageId: true },
      },
    },
  });

  return userOrganizations.map((uo) => uo.organization);
};

export const getPaginatedAndFilterableOrganizations = async ({
  request,
}: {
  request: LoaderFunctionArgs["request"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);
  const perPage = 25;

  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the assetss belonging to current user */
  let where: Prisma.UserWhereInput = {};

  /** If the search string exists, add it to the where object */
  // if (search) {
  //   where.email = {
  //     contains: search,
  //     mode: "insensitive",
  //   };
  // }

  const [organizations, totalOrganizations] = await db.$transaction([
    /** Get the users */
    db.organization.findMany({
      skip,
      take,
      // where,
      orderBy: { createdAt: "desc" },
      include: {
        owner: true,
      },
    }),

    /** Count them */
    db.user.count({ where }),
  ]);

  const totalPages = Math.ceil(totalOrganizations / 25);

  return {
    page,
    perPage: 25,
    search,
    totalOrganizations,
    prev,
    next,
    organizations,
    totalPages,
  };
};
