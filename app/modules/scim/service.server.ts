import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { db } from "~/database/db.server";
import { createTeamMember } from "~/modules/team-member/service.server";
import {
  createUser,
  revokeAccessToOrganization,
} from "~/modules/user/service.server";
import { randomUsernameFromEmail } from "~/utils/user";
import { ScimError } from "./errors.server";
import { parseScimFilter } from "./filters.server";
import { userToScimResource } from "./mappers.server";
import type {
  ScimListResponse,
  ScimPatchOp,
  ScimUser,
  ScimUserInput,
} from "./types";
import { SCIM_SCHEMA_LIST_RESPONSE } from "./types";

const SCIM_USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  scimExternalId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

// ──────────────────────────────────────────────
// LIST / SEARCH
// ──────────────────────────────────────────────

export async function listScimUsers(
  organizationId: string,
  params: {
    startIndex?: number;
    count?: number;
    filter?: string;
  }
): Promise<ScimListResponse> {
  const startIndex = Math.max(params.startIndex ?? 1, 1);
  const count = Math.min(Math.max(params.count ?? 100, 1), 100);

  const where: Prisma.UserWhereInput = {
    userOrganizations: { some: { organizationId } },
  };

  if (params.filter) {
    const parsed = parseScimFilter(params.filter);
    if (parsed) {
      if (parsed.attribute === "username") {
        where.email = { equals: parsed.value, mode: "insensitive" };
      } else if (parsed.attribute === "externalid") {
        where.scimExternalId = parsed.value;
      }
    }
  }

  const [users, totalResults] = await Promise.all([
    db.user.findMany({
      where,
      select: SCIM_USER_SELECT,
      skip: startIndex - 1, // SCIM is 1-based
      take: count,
      orderBy: { createdAt: "asc" },
    }),
    db.user.count({ where }),
  ]);

  return {
    schemas: [SCIM_SCHEMA_LIST_RESPONSE],
    totalResults,
    startIndex,
    itemsPerPage: users.length,
    Resources: users.map((u) => userToScimResource(u, true)),
  };
}

// ──────────────────────────────────────────────
// GET
// ──────────────────────────────────────────────

export async function getScimUser(
  organizationId: string,
  userId: string
): Promise<ScimUser> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ...SCIM_USER_SELECT,
      userOrganizations: {
        where: { organizationId },
        select: { id: true },
      },
    },
  });

  if (!user) {
    throw new ScimError("User not found", 404);
  }

  const isActive = user.userOrganizations.length > 0;
  return userToScimResource(user, isActive);
}

// ──────────────────────────────────────────────
// CREATE
// ──────────────────────────────────────────────

export async function createScimUser(
  organizationId: string,
  input: ScimUserInput
): Promise<ScimUser> {
  const email = (input.userName || input.emails?.[0]?.value)?.toLowerCase();
  if (!email) {
    throw new ScimError("userName (email) is required", 400);
  }

  const firstName = input.name?.givenName ?? null;
  const lastName = input.name?.familyName ?? null;
  const externalId = input.externalId ?? null;

  // Check if user already exists in Shelf DB
  const existingUser = await db.user.findUnique({
    where: { email },
    select: {
      ...SCIM_USER_SELECT,
      userOrganizations: {
        where: { organizationId },
        select: { id: true },
      },
    },
  });

  if (existingUser) {
    // Already in this org -> 409 conflict
    if (existingUser.userOrganizations.length > 0) {
      throw new ScimError(
        `User with userName "${email}" already exists in this organization`,
        409,
        "uniqueness"
      );
    }

    // Exists in Shelf but not in this org -> attach
    await db.userOrganization.create({
      data: {
        userId: existingUser.id,
        organizationId,
        roles: [OrganizationRoles.SELF_SERVICE],
      },
    });

    const teamMemberName =
      [firstName, lastName].filter(Boolean).join(" ") || email;
    await createTeamMember({
      name: teamMemberName,
      organizationId,
      userId: existingUser.id,
    });

    // Update scimExternalId if provided
    if (externalId) {
      await db.user.update({
        where: { id: existingUser.id },
        data: { scimExternalId: externalId },
      });
    }

    const updatedUser = await db.user.findUniqueOrThrow({
      where: { id: existingUser.id },
      select: SCIM_USER_SELECT,
    });

    return userToScimResource(updatedUser, true);
  }

  // User doesn't exist — create in Shelf DB only.
  // We do NOT create a Supabase auth account here. When the user signs in
  // via SSO, the SSO callback will create the auth account and link it
  // to this Shelf user by updating the user ID.
  const placeholderId = randomUUID();
  const username = randomUsernameFromEmail(email);

  const newUser = await createUser({
    userId: placeholderId,
    email,
    username,
    firstName,
    lastName,
    organizationId,
    roles: [OrganizationRoles.SELF_SERVICE],
    isSSO: true,
    skipPersonalOrg: true,
  });

  // Set scimExternalId and create TeamMember
  if (externalId) {
    await db.user.update({
      where: { id: newUser.id },
      data: { scimExternalId: externalId },
    });
  }

  const teamMemberName =
    [firstName, lastName].filter(Boolean).join(" ") || email;
  await createTeamMember({
    name: teamMemberName,
    organizationId,
    userId: newUser.id,
  });

  const createdUser = await db.user.findUniqueOrThrow({
    where: { id: newUser.id },
    select: SCIM_USER_SELECT,
  });

  return userToScimResource(createdUser, true);
}

// ──────────────────────────────────────────────
// REPLACE (PUT)
// ──────────────────────────────────────────────

export async function replaceScimUser(
  organizationId: string,
  userId: string,
  input: ScimUserInput
): Promise<ScimUser> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ...SCIM_USER_SELECT,
      userOrganizations: {
        where: { organizationId },
        select: { id: true },
      },
    },
  });

  if (!user) {
    throw new ScimError("User not found", 404);
  }

  const firstName = input.name?.givenName ?? null;
  const lastName = input.name?.familyName ?? null;
  const externalId = input.externalId ?? null;

  // Update user attributes
  await db.user.update({
    where: { id: userId },
    data: {
      firstName,
      lastName,
      scimExternalId: externalId,
    },
  });

  // Update team member name if exists
  const teamMemberName =
    [firstName, lastName].filter(Boolean).join(" ") || user.email;
  await db.teamMember.updateMany({
    where: { userId, organizationId },
    data: { name: teamMemberName },
  });

  const isCurrentlyActive = user.userOrganizations.length > 0;
  const shouldBeActive = input.active !== false;

  // Handle activation state changes
  if (isCurrentlyActive && !shouldBeActive) {
    await revokeAccessToOrganization({ userId, organizationId });
  } else if (!isCurrentlyActive && shouldBeActive) {
    await reactivateUser(userId, organizationId, teamMemberName);
  }

  const updatedUser = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: SCIM_USER_SELECT,
  });

  return userToScimResource(updatedUser, shouldBeActive);
}

// ──────────────────────────────────────────────
// PATCH
// ──────────────────────────────────────────────

export async function patchScimUser(
  organizationId: string,
  userId: string,
  patchOp: ScimPatchOp
): Promise<ScimUser> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      ...SCIM_USER_SELECT,
      userOrganizations: {
        where: { organizationId },
        select: { id: true },
      },
    },
  });

  if (!user) {
    throw new ScimError("User not found", 404);
  }

  let isActive = user.userOrganizations.length > 0;
  const updateData: Prisma.UserUpdateInput = {};

  for (const op of patchOp.Operations) {
    if (op.op !== "replace") {
      continue; // Only support "replace" operations for now
    }

    if (op.path === "active") {
      const newActive = op.value === true || op.value === "True";
      if (isActive && !newActive) {
        await revokeAccessToOrganization({ userId, organizationId });
        isActive = false;
      } else if (!isActive && newActive) {
        const name =
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.email;
        await reactivateUser(userId, organizationId, name);
        isActive = true;
      }
    } else if (op.path === "name.givenName") {
      updateData.firstName = String(op.value ?? "");
    } else if (op.path === "name.familyName") {
      updateData.lastName = String(op.value ?? "");
    } else if (op.path === "externalId") {
      updateData.scimExternalId = String(op.value ?? "");
    } else if (!op.path && typeof op.value === "object" && op.value !== null) {
      // Entra sometimes sends: { op: "replace", value: { active: false } }
      const val = op.value as Record<string, unknown>;
      if ("active" in val) {
        const newActive = val.active === true || val.active === "True";
        if (isActive && !newActive) {
          await revokeAccessToOrganization({ userId, organizationId });
          isActive = false;
        } else if (!isActive && newActive) {
          const name =
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            user.email;
          await reactivateUser(userId, organizationId, name);
          isActive = true;
        }
      }
      if ("name" in val && typeof val.name === "object" && val.name !== null) {
        const name = val.name as Record<string, unknown>;
        if ("givenName" in name) {
          updateData.firstName = String(name.givenName ?? "");
        }
        if ("familyName" in name) {
          updateData.lastName = String(name.familyName ?? "");
        }
      }
      if ("externalId" in val) {
        updateData.scimExternalId = String(val.externalId ?? "");
      }
    }
  }

  // Apply accumulated updates
  if (Object.keys(updateData).length > 0) {
    await db.user.update({ where: { id: userId }, data: updateData });

    // Sync team member name if name changed
    if (
      updateData.firstName !== undefined ||
      updateData.lastName !== undefined
    ) {
      const updatedUser = await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { firstName: true, lastName: true, email: true },
      });
      const teamMemberName =
        [updatedUser.firstName, updatedUser.lastName]
          .filter(Boolean)
          .join(" ") || updatedUser.email;
      await db.teamMember.updateMany({
        where: { userId, organizationId },
        data: { name: teamMemberName },
      });
    }
  }

  const updatedUser = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: SCIM_USER_SELECT,
  });

  return userToScimResource(updatedUser, isActive);
}

// ──────────────────────────────────────────────
// DEACTIVATE (DELETE)
// ──────────────────────────────────────────────

export async function deactivateScimUser(
  organizationId: string,
  userId: string
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      userOrganizations: {
        where: { organizationId },
        select: { id: true },
      },
    },
  });

  if (!user) {
    throw new ScimError("User not found", 404);
  }

  if (user.userOrganizations.length === 0) {
    // Already deactivated — idempotent
    return;
  }

  await revokeAccessToOrganization({ userId, organizationId });
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

/**
 * Re-adds a previously deactivated user to the organization.
 * Creates a new UserOrganization + TeamMember.
 */
async function reactivateUser(
  userId: string,
  organizationId: string,
  name: string
) {
  await db.userOrganization.create({
    data: {
      userId,
      organizationId,
      roles: [OrganizationRoles.SELF_SERVICE],
    },
  });

  await createTeamMember({
    name,
    organizationId,
    userId,
  });
}
