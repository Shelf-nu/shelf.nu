/* eslint-disable no-console */
import type { Role } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const createUserRole = async () => {
  const existingRole = await prisma.role.findFirst({
    where: {
      name: "USER",
    },
  });

  if (existingRole) return;

  return await prisma.role.create({
    data: {
      name: "USER",
    },
  });
};

const createAdminRole = async () => {
  const existingRole = await prisma.role.findFirst({
    where: {
      name: "ADMIN",
    },
  });

  if (existingRole) return;

  return await prisma.role.create({
    data: {
      name: "USER",
    },
  });
};

const addUserRoleToAllExistingUsers = async () => {
  const allUsers = await prisma.user.findMany();

  const userRole = (await prisma.role.findFirst({
    where: {
      name: "USER",
    },
  })) as Role;

  allUsers.map(async (user) => {
    await prisma.user.update({
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

  return await prisma.role.create({
    data: {
      name: "USER",
    },
  });
};

async function seed() {
  try {
    const userRole = await createUserRole();
    if (userRole) {
      console.log(`User role already exists. Skipping...`);
    } else {
      console.log(`User role created.`);
    }

    const adminRole = await createAdminRole();
    if (adminRole) {
      console.log(`Admin role already exists. Skipping...`);
    } else {
      console.log(`Admin role created.`);
    }

    await addUserRoleToAllExistingUsers();

    console.log("all users roles updated");

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
