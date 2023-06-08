import { Prisma } from "@prisma/client";
import type { Category, User } from "@prisma/client";
import { db } from "~/database";

import type { AuthSession } from "~/modules/auth";

import {
  createEmailAuthAccount,
  signInWithEmail,
  deleteAuthAccount,
  updateAccountPassword,
} from "~/modules/auth";
import type { UpdateUserPayload, UpdateUserResponse } from "./types";

export const defaultUserCategories: Pick<
  Category,
  "name" | "description" | "color"
>[] = [
  {
    name: "Office Equipment",
    description:
      "Items that are used for office work, such as computers, printers, scanners, phones, etc.",
    color: "#ab339f",
  },
  {
    name: "Cables",
    description:
      "Wires that connect devices or transmit signals, such as power cords, ethernet cables, HDMI cables, etc.",
    color: "#0dec5d",
  },
  {
    name: "Machinery",
    description:
      "Equipment that performs mechanical tasks, such as drills, saws, lathes, etc.",
    color: "#efa578",
  },
  {
    name: "Inventory",
    description:
      "Goods that are stored or sold by a business, such as raw materials, finished products, spare parts, etc.",
    color: "#376dd8",
  },
  {
    name: "Furniture",
    description:
      "Items that are used for sitting, working, or storing things, such as chairs, desks, shelves, cabinets, etc.",
    color: "#88a59e",
  },
  {
    name: "Supplies",
    description:
      "Items that are consumed or used up in a process, such as paper, ink, pens, tools, etc.",
    color: "#acbf01",
  },
  {
    name: "Other",
    description: "Any other items that do not fit into the above categories.",
    color: "#48ecfc",
  },
];

export async function getUserByEmail(email: User["email"]) {
  return db.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function getUserByID(id: User["id"]) {
  return db.user.findUnique({ where: { id } });
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
        categories: {
          create: defaultUserCategories,
        },
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

export async function updateUser(
  updateUserPayload: UpdateUserPayload
): Promise<UpdateUserResponse> {
  try {
    /** Remove password from object so we can pass it to prisma user update */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const cleanClone = (({ password, confirmPassword, ...o }) => o)(
      updateUserPayload
    );

    const updatedUser = await db.user.update({
      where: { id: updateUserPayload.id },
      data: {
        ...cleanClone,
      },
    });

    if (updateUserPayload?.password) {
      updateAccountPassword(updateUserPayload.id, updateUserPayload.password);
    }

    return { user: updatedUser, errors: null };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      // The .code property can be accessed in a type-safe manner
      if (e.code === "P2002") {
        return {
          user: null,
          errors: {
            [e?.meta?.target as string]: `${e?.meta?.target} is already taken.`,
          },
        };
      } else {
        return { user: null, errors: { global: "Unknown error." } };
      }
    }
    return { user: null, errors: null };
  }
}
