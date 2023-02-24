import { PrismaClientKnownRequestError } from "@prisma/client/runtime";
import type { User } from "~/database";
import { db } from "~/database";

import type { AuthSession } from "~/modules/auth";

import {
  createEmailAuthAccount,
  signInWithEmail,
  deleteAuthAccount,
} from "~/modules/auth";
import type { UpdateUserPayload, UpdateUserResponse } from "./types";

export async function getUserByEmail(email: User["email"]) {
  return db.user.findUnique({ where: { email: email.toLowerCase() } });
}

async function createUser({
  email,
  userId,
  username,
}: Pick<AuthSession & { username: string }, "userId" | "email" | "username">) {
  return db.user
    .create({
      data: {
        email,
        id: userId,
        username,
      },
    })
    .then((user) => user)
    .catch(() => null);
}

export async function tryCreateUser({
  email,
  userId,
  username,
}: Pick<AuthSession & { username: string }, "userId" | "email" | "username">) {
  const user = await createUser({
    userId,
    email,
    username,
  });

  // user account created and have a session but unable to store in User table
  // we should delete the user account to allow retry create account again
  if (!user) {
    await deleteAuthAccount(userId);
    return null;
  }

  return user;
}

export async function createUserAccount(
  email: string,
  password: string,
  username: string
): Promise<AuthSession | null> {
  const authAccount = await createEmailAuthAccount(email, password);
  // ok, no user account created
  if (!authAccount) return null;

  const authSession = await signInWithEmail(email, password);

  // user account created but no session 😱
  // we should delete the user account to allow retry create account again
  if (!authSession) {
    await deleteAuthAccount(authAccount.id);
    return null;
  }

  const user = await tryCreateUser({ ...authSession, username });

  if (!user) return null;

  return authSession;
}


export async function updateUser(updateUserPayload: UpdateUserPayload): Promise<UpdateUserResponse> {
  try {
    const updatedUser = await db.user.update({
      where: { id: updateUserPayload.id },
      data: {
        ...updateUserPayload,
      },
    })
    return { user: updatedUser, error: null }
  } catch (e) {
    if (e instanceof PrismaClientKnownRequestError && e.code === 'P2002') {
      const message = `Could not update user: ${e.meta.target} already exists`
      return { user: null, error: { message } }
    } else {
      const message = `Unknown error: ${e.message}`
      return { user: null, error: { message } }
    }
  }
}