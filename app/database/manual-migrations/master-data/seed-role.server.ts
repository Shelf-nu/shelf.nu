/* eslint-disable no-console */
import type { Role } from "@prisma/client";
import { PrismaClient, Roles } from "@prisma/client";
import { ShelfStackError } from "~/utils/error";

const prisma = new PrismaClient();

export const createUserRole = async () => {
  const existingRole = await prisma.role.findFirst({
    where: {
      name: Roles["USER"],
    },
  });

  if (existingRole) return null;

  return await prisma.role.create({
    data: {
      name: Roles["USER"],
    },
  });
};

export const createAdminRole = async () => {
  const existingRole = await prisma.role.findFirst({
    where: {
      name: Roles["ADMIN"],
    },
  });

  if (existingRole) return null;

  return await prisma.role.create({
    data: {
      name: Roles["ADMIN"],
    },
  });
};

const addUserRoleToAllExistingUsers = async () => {
  const allUsers = await prisma.user.findMany({
    include: {
      roles: true,
    },
  });

  const userRole = (await prisma.role.findFirst({
    where: {
      name: Roles["USER"],
    },
  })) as Role;

  allUsers.map(async (user) => {
    if (user.roles?.some((role) => role.name === Roles["USER"])) return;
    return await prisma.user.update({
      where: {
        id: user.id,
      },
      data: {
        roles: {
          connect: {
            id: userRole.id,
          },
        },
      },
    });
  });

  return allUsers;
};

async function seed() {
  try {
    const userRole = await createUserRole();
    if (userRole) {
      console.log(`User role created.`);
    } else {
      console.log(`User role already exists. Skipping...`);
    }

    const adminRole = await createAdminRole();
    if (adminRole) {
      console.log(`Admin role created.`);
    } else {
      console.log(`Admin role already exists. Skipping...`);
    }

    const allUsers = await addUserRoleToAllExistingUsers();

    console.log(`Total of ${allUsers.length} users' roles updated`);

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
