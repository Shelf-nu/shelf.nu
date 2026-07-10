import { SERVER_URL } from "~/utils/env";
import { ScimError } from "./errors.server";
import type { ScimUser } from "./types";
import { SCIM_SCHEMA_USER } from "./types";

interface ShelfUserForScim {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /**
   * Org-scoped SCIM external id relation, pre-filtered to the calling org, so
   * at most one entry. Its `scimExternalId` is the IdP's object id AND the
   * SCIM-facing resource `id` we hand back (see {@link userToScimResource}).
   */
  scimExternalIds: { scimExternalId: string }[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Maps a Shelf User to a SCIM User resource (RFC 7643).
 *
 * The SCIM resource `id` is the per-org external id (the IdP object id), NOT
 * `User.id`. `User.id` is rewritten to the Supabase auth UUID on first SSO
 * login, so keying the SCIM id off it would make every id the IdP cached go
 * stale (404 on later GET/PATCH/DELETE). The per-org external id never changes,
 * so `id` (and `externalId`, and `meta.location`) are all derived from it.
 *
 * @param user - The Shelf user record; MUST carry its org-scoped external id
 * @param isActive - Whether the user currently has a UserOrganization for the
 *                   SCIM token's organization (drives the `active` field)
 * @throws {ScimError} 500 if the user has no external id for this org — callers
 *   only ever map SCIM-provisioned users, so this indicates a programming error.
 */
export function userToScimResource(
  user: ShelfUserForScim,
  isActive: boolean
): ScimUser {
  const scimId = user.scimExternalIds[0]?.scimExternalId;
  if (!scimId) {
    throw new ScimError(
      "Cannot create a SCIM resource for a user without an external id",
      500
    );
  }

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return {
    schemas: [SCIM_SCHEMA_USER],
    id: scimId,
    externalId: scimId,
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
      location: `${SERVER_URL}/api/scim/v2/Users/${scimId}`,
    },
  };
}
