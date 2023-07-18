/* eslint-disable no-console */
import type { Role } from "@prisma/client";
import { PrismaClient, Roles } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Organizations, teams, custodians


Due to there being assets already existing we need to do a 2 step process

1. Make organizationId within asset to not be required
2. Create a script that creates organizations for all users and then links all assets of the user to organization
3. Make organizationId to be required

 */

async function seed() {
  try {
    // console.log(`Total of ${allUsers.length} users' roles updated`);

    console.log(`Database has been seeded. 🌱\n`);
  } catch (cause) {
    console.error(cause);
    throw new Error("Seed failed 🥲");
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
