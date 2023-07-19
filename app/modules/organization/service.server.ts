import { OrganizationType, type Organization } from "@prisma/client";
import { db } from "~/database";

export const getUserPersonalOrganization = async ({
  userId,
}: {
  userId: string;
}) =>
  db.organization.findFirst({
    where: {
      userId,
      type: OrganizationType.PERSONAL,
    },
    include: {
      members: true,
    },
  });

export const getOrganization = async ({ id }: { id: Organization["id"] }) =>
  db.organization.findUnique({
    where: { id },
    include: {
      members: true,
    },
  });
