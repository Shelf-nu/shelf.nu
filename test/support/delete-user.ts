// Use this to delete a user by their email
// Simply call this with:

import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { installGlobals } from "@remix-run/node";

import { db } from "~/database";
import { deleteAuthAccount } from "~/modules/auth";
import { getUserByEmail } from "~/modules/user";

installGlobals();

export async function deleteUser(email: string) {
  if (!email) {
    throw new Error("email required for login");
  }
  const user = await getUserByEmail(email);

  try {
    await db.user.delete({ where: { email } });
  } catch (error) {
    if (
      error instanceof PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      // eslint-disable-next-line no-console
      console.log("User not found, so no need to delete");
    } else {
      throw error;
    }
  }

  await deleteAuthAccount(user?.id as string);
}

// deleteUser(process.argv[2]);
