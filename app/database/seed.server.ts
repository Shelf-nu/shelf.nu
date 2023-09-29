/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

import { createUser } from "~/modules/user";
import { ShelfStackError } from "~/utils/error";
import {
  createAdminRole,
  createUserRole,
} from "./manual-migrations/master-data/seed-role.server";
import { SUPABASE_SERVICE_ROLE, SUPABASE_URL } from "../utils/env";

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const prisma = new PrismaClient();

const email = "hello@supabase.com";

const getUserId = async (email = "hello@supabase.com"): Promise<string> => {
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
    password: "supabase",
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
      username: "supabase",
    });

    if (!user) {
      throw new ShelfStackError({ message: "Unable to create user" });
    }

    console.log(`Database has been seeded. 🌱\n`);
    console.log(
      `User added to your database 👇 \n🆔: ${user.id}\n📧: ${user.email}\n🔑: supabase`
    );
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
