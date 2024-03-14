import type { Organization, User } from "@prisma/client";
import { Prisma, Roles, OrganizationRoles } from "@prisma/client";
import type { ITXClientDenyList } from "@prisma/client/runtime/library";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import sharp from "sharp";
import type { AuthSession } from "server/session";
import type { ExtendedPrismaClient } from "~/database";
import { db } from "~/database";

import {
  deleteAuthAccount,
  createEmailAuthAccount,
  signInWithEmail,
  updateAccountPassword,
} from "~/modules/auth";

import type { ValidationError } from "~/utils";
import {
  dateTimeInUnix,
  getCurrentSearchParams,
  getParamsValues,
  randomUsernameFromEmail,
} from "~/utils";
import type { ErrorLabel } from "~/utils/error";
import { ShelfError, isLikeShelfError } from "~/utils/error";
import {
  deleteProfilePicture,
  getPublicFileURL,
  parseFileFormData,
} from "~/utils/storage.server";
import type { UpdateUserPayload } from "./types";
import { defaultUserCategories } from "../category/default-categories";

const label: ErrorLabel = "User";

export async function findUserByEmail(email: User["email"]) {
  try {
    return await db.user.findUnique({ where: { email: email.toLowerCase() } });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to find user",
      additionalData: { email },
      label,
    });
  }
}

export async function getUserByID(id: User["id"]) {
  try {
    return await db.user.findUniqueOrThrow({ where: { id } });
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "No user found with this ID",
      additionalData: { id },
      label,
    });
  }
}

async function createUserOrgAssociation(
  tx: Omit<ExtendedPrismaClient, ITXClientDenyList>,
  payload: {
    roles: OrganizationRoles[];
    organizationIds: Organization["id"][];
    userId: User["id"];
  }
) {
  const { organizationIds, userId, roles } = payload;

  try {
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
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to create user organization association",
      additionalData: { payload },
      label,
    });
  }
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
  try {
    const shelfUser = await db.user.findFirst({ where: { email } });

    /**
     * If user does not exist, create a new user and attach the org to it
     * WE have a case where a user registers which only creates an auth account and before confirming their email they try to accept an invite
     * This will always fail because we need them to confirm their email before we create a user in shelf
     */
    if (!shelfUser?.id) {
      const authAccount = await createEmailAuthAccount(email, password).catch(
        (cause) => {
          throw new ShelfError({
            cause,
            message:
              "We are facing some issue with your account. Most likely you are trying to accept an invite, before you have confirmed your account's email. Please try again after confirming your email. If the issue persists, feel free to contact support.",
            label,
          });
        }
      );

      return await createUser({
        email,
        userId: authAccount.id,
        username: randomUsernameFromEmail(email),
        organizationId,
        roles,
        firstName,
      });
    }

    /** If the user already exists, we just attach the new org to it */
    await createUserOrgAssociation(db, {
      userId: shelfUser.id,
      organizationIds: [organizationId],
      roles,
    });

    return shelfUser;
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: isLikeShelfError(cause)
        ? cause.message
        : `There was an issue with creating/attaching user with email: ${email}`,
      additionalData: { email, organizationId, roles, firstName },
      label,
    });
  }
}

export async function createUser(
  payload: Pick<
    AuthSession & { username: string },
    "userId" | "email" | "username"
  > & {
    organizationId?: Organization["id"];
    roles?: OrganizationRoles[];
    firstName?: User["firstName"];
  }
) {
  const { email, userId, username, organizationId, roles, firstName } = payload;

  try {
    return await db.$transaction(
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
    );
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "We had trouble while creating your account. Please try again.",
      additionalData: {
        payload,
      },
      label,
    });
  }
}

export async function updateUser(updateUserPayload: UpdateUserPayload) {
  /**
   * Remove password from object so we can pass it to prisma user update
   * Also we remove the email as we dont allow it to be changed for now
   * */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const cleanClone = (({ password, confirmPassword, email, ...o }) => o)(
    updateUserPayload
  );

  try {
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

    return updatedUser;
  } catch (cause) {
    const validationErrors: ValidationError<any> = {};

    if (
      cause instanceof Prisma.PrismaClientKnownRequestError &&
      cause.code === "P2002"
    ) {
      // The .code property can be accessed in a type-safe manner
      validationErrors[cause.meta?.target as string] = {
        message: `${cause.meta?.target} is already taken.`,
      };
    }

    throw new ShelfError({
      cause,
      message:
        "Something went wrong while updating your profile. Please try again or contact support.",
      additionalData: { ...cleanClone, validationErrors },
      label,
    });
  }
}

export const getPaginatedAndFilterableUsers = async ({
  request,
}: {
  request: LoaderFunctionArgs["request"];
}) => {
  const searchParams = getCurrentSearchParams(request);
  const { page, search } = getParamsValues(searchParams);

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
  return updateUser({
    id: userId,
    profilePicture: getPublicFileURL({ filename: profilePicture }),
  });
}

export async function deleteUser(id: User["id"]) {
  if (!id) {
    // @TODO Solve error handling
    throw new ShelfError({
      cause: null,
      message: "User ID is required",
      label,
    });
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

/** THis function is used just for integration tests as it combines the creation of auth account and user entry */
export async function createUserAccountForTesting(
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

  const user = await createUser({
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
  try {
    /**
     * if I want to revokeAccess access, i simply need to:
     * 1. Remove relation between user and team member
     * 2. remove the UserOrganization entry which has the org.id and user.id that i am revoking
     */
    const teamMember = await db.teamMember.findFirst({
      where: { userId, organizationId },
    });

    return await db.user.update({
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
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "Failed to revoke user access to organization",
      additionalData: { userId, organizationId },
      label,
    });
  }
}
