import type { PrismaClient, Organization, User } from "@prisma/client";
import { Prisma, Roles, OrganizationRoles } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { json, type LoaderFunctionArgs } from "@remix-run/node";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import sharp from "sharp";
import { db } from "~/database";

import {
  deleteAuthAccount,
  type AuthSession,
  createEmailAuthAccount,
  signInWithEmail,
  updateAccountPassword,
} from "~/modules/auth";

import {
  dateTimeInUnix,
  generatePageMeta,
  getCurrentSearchParams,
  getParamsValues,
  randomUsernameFromEmail,
} from "~/utils";
import { ShelfStackError } from "~/utils/error";
import {
  deleteProfilePicture,
  getPublicFileURL,
  parseFileFormData,
} from "~/utils/storage.server";
import type { UpdateUserPayload, UpdateUserResponse } from "./types";
import { defaultUserCategories } from "../category/default-categories";

export async function getUserByEmail(email: User["email"]) {
  return db.user.findUnique({ where: { email: email.toLowerCase() } });
}

export async function getUserByID(id: User["id"]) {
  return db.user.findUnique({ where: { id } });
}

export async function getUserByIDWithOrg(id: User["id"]) {
  return db.user.findUnique({
    where: { id },
    include: { organizations: true },
  });
}

async function createUserOrgAssociation(
  tx: Omit<PrismaClient, ITXClientDenyList>,
  {
    organizationIds,
    userId,
    roles,
  }: {
    roles: OrganizationRoles[];
    organizationIds: Organization["id"][];
    userId: User["id"];
  }
) {
  return await Promise.all(
    Array.from(new Set(organizationIds)).map((organizationId) =>
      tx.userOrganization.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
        create: {
          userId,
          organizationId,
          roles,
        },
        update: {
          roles: {
            push: roles,
          },
        },
      })
    )
  );
}

export async function createUserOrAttachOrg({
  email,
  organizationId,
  roles,
  password,
  firstName,
}: Pick<User, "email" | "firstName"> & {
  organizationId: Organization["id"];
  roles: OrganizationRoles[];
  password: string;
}) {
  const shelfUser = await db.user.findFirst({ where: { email } });
  let authAccount: SupabaseUser | null = null;

  /**
   * If user does not exist, create a new user and attach the org to it
   */
  if (!shelfUser?.id) {
    authAccount = await createEmailAuthAccount(email, password);
    if (!authAccount) {
      throw new ShelfStackError({
        status: 500,
        message: "failed to create auth account",
      });
    }

    const user = await createUser({
      email,
      userId: authAccount.id,
      username: randomUsernameFromEmail(email),
      organizationId,
      roles,
      firstName,
    });
    return user;
  }

  await createUserOrgAssociation(db, {
    userId: shelfUser.id,
    organizationIds: [organizationId],
    roles,
  });
  return shelfUser;
}

export async function createUser({
  email,
  userId,
  username,
  organizationId,
  roles,
  firstName,
}: Pick<AuthSession & { username: string }, "userId" | "email" | "username"> & {
  organizationId?: Organization["id"];
  roles?: OrganizationRoles[];
  firstName?: User["firstName"];
}) {
  return db
    .$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            id: userId,
            username,
            firstName,
            organizations: {
              create: [
                {
                  name: "Personal",
                  categories: {
                    create: defaultUserCategories.map((c) => ({
                      ...c,
                      userId,
                    })),
                  },
                },
              ],
            },
            roles: {
              connect: {
                name: Roles["USER"],
              },
            },
          },
          include: {
            organizations: true,
          },
        });
        const organizationIds: Organization["id"][] = [
          user.organizations[0].id,
        ];
        if (organizationId) {
          organizationIds.push(organizationId);
        }

        await Promise.all([
          createUserOrgAssociation(tx, {
            userId: user.id,
            organizationIds: [user.organizations[0].id],
            roles: [OrganizationRoles.OWNER],
          }),
          organizationId &&
            roles?.length &&
            createUserOrgAssociation(tx, {
              userId: user.id,
              organizationIds: [organizationId],
              roles,
            }),
        ]);
        return user;
      },
      { maxWait: 6000, timeout: 10000 }
    )
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
        teamMembers: {
          updateMany: {
            where: { userId: updateUserPayload.id },
            data: {
              name: `${
                updateUserPayload.firstName ? updateUserPayload.firstName : ""
              } ${
                updateUserPayload.lastName ? updateUserPayload.lastName : ""
              }`,
            },
          },
        },
      },
    });

    if (
      updateUserPayload.password &&
      updateUserPayload.password.trim() !== ""
    ) {
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
  request: LoaderFunctionArgs["request"];
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
    throw new ShelfStackError({ message: "User ID is required" });
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
export { defaultUserCategories };

/** THis function is used just for integration tests as it combines the creation of auth accound and user entry */
export async function createUserAccountForTesting(
  email: string,
  password: string,
  username: string
): Promise<AuthSession | null> {
  const authAccount = await createEmailAuthAccount(email, password);
  // ok, no user account created
  if (!authAccount) return null;

  const { authSession } = await signInWithEmail(email, password);

  // user account created but no session 😱
  // we should delete the user account to allow retry create account again
  if (!authSession) {
    await deleteAuthAccount(authAccount.id);
    return null;
  }

  const user = await tryCreateUser({
    email: authSession.email,
    userId: authSession.userId,
    username,
  });

  if (!user) return null;

  return authSession;
}

export async function revokeAccessToOrganization({
  userId,
  organizationId,
}: {
  userId: User["id"];
  organizationId: Organization["id"];
}) {
  /**
   * if I want to revoke access, i simply need to:
   * 1. Remove relation between user and team member
   * 2. remove the UserOrganization entry which has the org.id and user.id that i am revoking
   */
  const teamMember = await db.teamMember.findFirst({
    where: { userId, organizationId },
  });

  const user = await db.user.update({
    where: { id: userId },
    data: {
      ...(teamMember?.id && {
        teamMembers: {
          disconnect: {
            id: teamMember.id,
          },
        },
      }),
      userOrganizations: {
        delete: {
          userId_organizationId: {
            userId,
            organizationId,
          },
        },
      },
    },
  });
  return user;
}
