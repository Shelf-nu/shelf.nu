import { OrganizationType, type Organization } from "@prisma/client";
import { db } from "~/database";

export const getUserPersonalOrganizationData = async ({
  userId,
}: {
  userId: string;
}) => {
  const where = {
    userId,
  };
  const [organization, totalAssets, totalLocations] = await db.$transaction([
    /** Get the assets */
    db.organization.findFirst({
      where: {
        userId,
        type: OrganizationType.PERSONAL,
      },
      include: {
        members: {
          include: {
            custodies: true,
          },
        },
      },
    }),

    /** Count the assets
     * Because we currently have only personal organizations, we just directly get the user's asset count
     */
    db.asset.count({
      where,
    }),

    /** Count the locations.
     * Same logic as with assets
     */
    db.location.count({
      where,
    }),
  ]);

  return {
    organization,
    totalAssets,
    totalLocations,
  };
};

export const getOrganization = async ({ id }: { id: Organization["id"] }) =>
  db.organization.findUnique({
    where: { id },
    include: {
      members: true,
    },
  });
