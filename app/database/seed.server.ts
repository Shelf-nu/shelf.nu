/* eslint-disable no-console */
import type { Role } from "@prisma/client";
import { PrismaClient, Roles } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

import { createUser } from "~/modules/user/service.server";
import { ShelfError } from "~/utils/error";

import {
  SUPABASE_SERVICE_ROLE,
  SUPABASE_URL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
} from "../utils/env";

export const createUserRole = async () => {
  const existingRole = await prisma.role.findFirst({
    where: {
      name: Roles["USER"],
    },
  });

  if (existingRole) return null;

  return prisma.role.create({
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

  return prisma.role.create({
    data: {
      name: Roles["ADMIN"],
    },
  });
};

export const addUserRoleToAllExistingUsers = async () => {
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

  await Promise.all(
    allUsers.map(async (user) => {
      if (
        user.roles?.some(
          (role) => role.name === Roles["USER"] || role.name === Roles["ADMIN"]
        )
      ) {
        return;
      }

      return prisma.user.update({
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
    })
  );

  return allUsers;
};

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const prisma = new PrismaClient();

const email = ADMIN_EMAIL || "hello@supabase.com";

const getUserId = async (
  email = ADMIN_EMAIL || "hello@supabase.com"
): Promise<string> => {
  const userList = await supabaseAdmin.auth.admin.listUsers();

  if (userList.error) {
    throw userList.error;
  }

  const existingUserId = userList.data.users.find(
    (user) => user.email === email
  )?.id;

  if (existingUserId) {
    return existingUserId;
  }

  const newUser = await supabaseAdmin.auth.admin.createUser({
    email,
    password: ADMIN_PASSWORD || "supabase",
    email_confirm: true,
  });

  if (newUser.error) {
    throw newUser.error;
  }

  return newUser.data.user.id;
};

async function seed() {
  try {
    const id = await getUserId();

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

    // cleanup the existing database
    await prisma.user.delete({ where: { email } }).catch(() => {
      // no worries if it doesn't exist yet
    });

    const user = await createUser({
      email,
      userId: id,
      username: ADMIN_USERNAME || "supabase",
    });

    if (!user) {
      throw new ShelfError({
        cause: null,
        message: "Unable to create user",
        label: "Unknown",
      });
    }

    await addUserRoleToAllExistingUsers();

    console.log(`Database has been seeded. 🌱\n`);
    console.log(
      `User added to your database 👇\n`,
      `🆔: ${user.id}\n`,
      `📧: ${user.email}\n`,
      `🔑: ${ADMIN_PASSWORD || "supabase"}`
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Seed failed 🥲",
      label: "Unknown",
    });
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
