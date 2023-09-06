import { Prisma, Roles } from "@prisma/client";
import type { Category, User } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { json, type LoaderArgs } from "@remix-run/node";
import sharp from "sharp";
import { db } from "~/database";

import type { AuthSession } from "~/modules/auth";

import {
  createEmailAuthAccount,
  signInWithEmail,
  deleteAuthAccount,
  updateAccountPassword,
} from "~/modules/auth";
import {
  dateTimeInUnix,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
} from "~/utils";
import {
  deleteProfilePicture,
  getPublicFileURL,
  parseFileFormData,
} from "~/utils/storage.server";
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

export async function createUser({
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
        organizations: {
          create: [
            {
              name: "Personal",
            },
          ],
        },
        roles: {
          connect: {
            name: Roles["USER"],
          },
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
    /**
     * Remove password from object so we can pass it to prisma user update
     * Also we remove the email as we dont allow it to be changed for now
     * */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const cleanClone = (({ password, confirmPassword, email, ...o }) => o)(
      updateUserPayload
    );

    const updatedUser = await db.user.update({
      where: { id: updateUserPayload.id },
      data: {
        ...cleanClone,
      },
    });

    if (updateUserPayload.password) {
      await updateAccountPassword(
        updateUserPayload.id,
        updateUserPayload.password
      );
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

export const getPaginatedAndFilterableUsers = async ({
  request,
}: {
  request: LoaderArgs["request"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);
  const { prev, next } = generatePageMeta(request);

  const { users, totalUsers } = await getUsers({
    page,
    perPage: 25,
    search,
  });
  const totalPages = Math.ceil(totalUsers / 25);

  return {
    page,
    perPage: 25,
    search,
    totalUsers,
    prev,
    next,
    users,
    totalPages,
  };
};

export async function getUsers({
  page = 1,
  perPage = 8,
  search,
}: {
  /** Page number. Starts at 1 */
  page: number;

  /** Assets to be loaded per page */
  perPage?: number;

  search?: string | null;
}) {
  const skip = page > 1 ? (page - 1) * perPage : 0;
  const take = perPage >= 1 && perPage <= 25 ? perPage : 8; // min 1 and max 25 per page

  /** Default value of where. Takes the assetss belonging to current user */
  let where: Prisma.UserWhereInput = {};

  /** If the search string exists, add it to the where object */
  if (search) {
    where.email = {
      contains: search,
      mode: "insensitive",
    };
  }

  const [users, totalUsers] = await db.$transaction([
    /** Get the users */
    db.user.findMany({
      skip,
      take,
      where,
      orderBy: { createdAt: "desc" },
    }),

    /** Count them */
    db.user.count({ where }),
  ]);

  return { users, totalUsers };
}

export async function updateProfilePicture({
  request,
  userId,
}: {
  request: Request;
  userId: User["id"];
}) {
  const user = await getUserByID(userId);
  const previousProfilePictureUrl = user?.profilePicture || undefined;

  const fileData = await parseFileFormData({
    request,
    newFileName: `${userId}/profile-${dateTimeInUnix(Date.now())}`,
    resizeOptions: {
      height: 150,
      width: 150,
      fit: sharp.fit.cover,
      withoutEnlargement: true,
    },
  });

  const profilePicture = fileData.get("profile-picture") as string;

  /** if profile picture is an empty string, the upload failed so we return an error */
  if (!profilePicture || profilePicture === "") {
    return json(
      {
        error: "Something went wrong. Please refresh and try again",
      },
      { status: 500 }
    );
  }

  if (previousProfilePictureUrl) {
    /** Delete the old picture  */
    await deleteProfilePicture({ url: previousProfilePictureUrl });
  }

  /** Update user with new picture */
  return await updateUser({
    id: userId,
    profilePicture: getPublicFileURL({ filename: profilePicture }),
  });
}

export async function deleteUser(id: User["id"]) {
  if (!id) {
    throw new Error("User ID is required");
  }

  try {
    const user = await db.user.findUnique({
      where: { id },
      include: { organizations: true },
    });

    /** Find the personal org of the user and delete it */
    const personalOrg = user?.organizations.find(
      (org) => org.type === "PERSONAL"
    );

    await db.organization.delete({
      where: { id: personalOrg?.id },
    });

    await db.user.delete({ where: { id } });
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

  await deleteAuthAccount(id);
}
