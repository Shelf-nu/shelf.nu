import { SERVER_URL } from "~/utils/env";
import type { ScimUser } from "./types";
import { SCIM_SCHEMA_USER } from "./types";

interface ShelfUserForScim {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  scimExternalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps a Shelf User to a SCIM User resource (RFC 7643).
 *
 * @param user - The Shelf user record
 * @param isActive - Whether the user has an active UserOrganization for the
 *                   SCIM token's organization
 */
export function userToScimResource(
  user: ShelfUserForScim,
  isActive: boolean
): ScimUser {
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return {
    schemas: [SCIM_SCHEMA_USER],
    id: user.id,
    ...(user.scimExternalId && { externalId: user.scimExternalId }),
    userName: user.email,
    name: {
      givenName: user.firstName ?? undefined,
      familyName: user.lastName ?? undefined,
      formatted: displayName !== user.email ? displayName : undefined,
    },
    displayName,
    emails: [
      {
        value: user.email,
        type: "work",
        primary: true,
      },
    ],
    active: isActive,
    meta: {
      resourceType: "User",
      created: user.createdAt.toISOString(),
      lastModified: user.updatedAt.toISOString(),
      location: `${SERVER_URL}/api/scim/v2/Users/${user.id}`,
    },
  };
}
