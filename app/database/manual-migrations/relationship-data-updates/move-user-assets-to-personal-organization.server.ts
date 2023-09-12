/* eslint-disable no-console */
import { OrganizationType, PrismaClient } from "@prisma/client";
import { ShelfStackError } from "~/utils/error";

const prisma = new PrismaClient();

/** IMPORTANT NOTE
 *
 * You dont need to run this migration yet. It is prepared for the future.
 */

async function seed() {
  try {
    // console.log(`Total of ${allUsers.length} users' roles updated`);
    const allUsers = await prisma.user.findMany({
      include: {
        organizations: true,
        assets: {
          include: {
            organization: true,
          },
        },
      },
    });

    allUsers.map(async (user) => {
      user.assets.map(async (asset) => {
        if (asset.organizationId) return;
        return await prisma.asset.update({
          where: {
            id: asset.id,
          },
          data: {
            organizationId: user.organizations.find(
              (organization) => organization.type === OrganizationType.PERSONAL
            )?.id,
          },
        });
      });
    });

    console.log(
      `Assets without organizationId have been assigned to PERSONAL organization. 🌱\n`
    );
    console.log(`Database has been seeded. 🌱\n`);
  } catch (cause) {
    throw new ShelfStackError({ message: "Seed failed 🥲", cause });
  }
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
