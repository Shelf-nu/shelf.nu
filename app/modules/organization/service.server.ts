import { OrganizationType } from "@prisma/client";
import type { Organization, User } from "@prisma/client";

import { db } from "~/database";
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
  await db.organization.findFirst({
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
    owner: {
      connect: {
        id: userId,
      },
    },
  };

  if (image?.size && image?.size > 0) {
    Object.assign(data, {
      image: {
        create: {
          blob: Buffer.from(await image.arrayBuffer()),
          contentType: image.type,
          user: {
            connect: {
              id: userId,
            },
          },
        },
      },
    });
  }

  return db.organization.create({ data });
}
