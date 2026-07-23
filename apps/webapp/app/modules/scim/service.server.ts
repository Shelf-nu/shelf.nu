import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { OrganizationRoles } from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { db } from "~/database/db.server";
import { getSupabaseAdmin } from "~/integrations/supabase/client";
import { createTeamMember } from "~/modules/team-member/service.server";
import {
  createUser,
  revokeAccessToOrganization,
} from "~/modules/user/service.server";
import { isLikeShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { emailMatchesDomains } from "~/utils/misc";
import { randomUsernameFromEmail } from "~/utils/user";
import { ScimError } from "./errors.server";
import { parseScimFilter } from "./filters.server";
import { userToScimResource } from "./mappers.server";
import type { ScimListResponse, ScimUser } from "./types";
import { SCIM_SCHEMA_LIST_RESPONSE } from "./types";
import type { ScimPatchOp, ScimUserInput } from "./validation.server";

/**
 * Returns a Prisma select object for SCIM user queries scoped to an org.
 * The `scimExternalIds` relation is pre-filtered to the calling org so the
 * result contains at most one entry (enforced by the unique constraint).
 */
function scimUserSelect(organizationId: string) {
  return {
    id: true,
    email: true,
    firstName: true,
    lastName: true,
    scimExternalIds: {
      where: { organizationId },
      select: { scimExternalId: true },
    },
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.UserSelect;
}

/**
 * Asserts that an email's domain belongs to the organization's verified SSO
 * domain(s) before it is provisioned or re-identified via SCIM.
 *
 * Every provisioning path (create, replace, and any PATCH that changes the
 * email) must pass this gate. Without it a SCIM token scoped to org A could
 * POST or rename a user at an arbitrary domain — including re-identifying an
 * existing Shelf user who belongs to a different organization. SCIM is only
 * ever used by SSO-enabled orgs, so an org with no configured SSO domain has
 * no identities it may legitimately provision.
 *
 * @param organizationId - The org the SCIM token is scoped to
 * @param email - The (already-lowercased) email being provisioned
 * @throws {ScimError} 400 `invalidValue` when the org has no verified SSO
 *   domain configured, or when the email's domain is not one of them.
 */
async function assertEmailAllowedForOrg(
  organizationId: string,
  email: string
): Promise<void> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: { ssoDetails: { select: { domain: true } } },
  });

  const configuredDomains = org?.ssoDetails?.domain ?? null;
  if (!configuredDomains) {
    throw new ScimError(
      "This organization has no verified SSO domain configured; SCIM provisioning is not permitted.",
      400,
      "invalidValue"
    );
  }

  const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!emailMatchesDomains(emailDomain, configuredDomains)) {
    throw new ScimError(
      `The email domain "${emailDomain}" is not part of this organization's verified SSO domain(s). SCIM can only provision users within the organization's own domain.`,
      400,
      "invalidValue"
    );
  }
}

/**
 * The 409 detail returned when provisioning would duplicate a user that is
 * already SCIM-managed in this organization. Shared by both create paths so the
 * IdP sees one consistent message whichever of them loses the race.
 */
function duplicateUserDetail(email: string): string {
  return `User with userName "${email}" already exists in this organization`;
}

/**
 * Rethrows a Prisma unique-constraint violation as the SCIM-spec 409
 * "uniqueness" error; any other error propagates unchanged.
 *
 * Every path that writes a user-identifying column does a read-then-write and
 * can therefore lose a race to a concurrent SCIM request. The pre-checks give a
 * clean 409 in the common case; this converts the constraint violation that
 * slips through, so a lost race is still a spec-compliant 409 rather than a 500
 * the IdP would treat as a transient server fault and retry.
 *
 * Unwraps `ShelfError` first: `createUser` wraps the Prisma error as its
 * `cause`, whereas a direct `db` call throws it raw.
 *
 * @param err - The caught error
 * @param detail - Human-readable 409 detail, surfaced in the IdP's logs
 * @throws {ScimError} 409 `uniqueness` on P2002
 * @throws The original error otherwise
 */
function throwScimUniquenessIfP2002(err: unknown, detail: string): never {
  const cause = isLikeShelfError(err) ? err.cause : err;

  if (
    cause instanceof PrismaClientKnownRequestError &&
    cause.code === "P2002"
  ) {
    throw new ScimError(detail, 409, "uniqueness");
  }

  throw err;
}

/**
 * Creates the SCIM mapping row (`UserScimExternalId`) that links a Shelf user to
 * the IdP's object id within one org. The `scimExternalId` becomes the stable,
 * SCIM-facing resource id (see {@link userToScimResource}); the mapping persists
 * across deactivation and is only removed by a SCIM DELETE.
 *
 * @throws {ScimError} 409 `uniqueness` when the user is already mapped in this
 *   org, or the external id is already used by another user in the org.
 */
async function createScimMapping(
  userId: string,
  organizationId: string,
  scimExternalId: string,
  email: string
): Promise<void> {
  try {
    await db.userScimExternalId.create({
      data: { userId, organizationId, scimExternalId },
    });
  } catch (err) {
    throwScimUniquenessIfP2002(err, duplicateUserDetail(email));
  }
}

/**
 * Resolves a SCIM resource id (the per-org external id) to the underlying Shelf
 * user, or throws 404.
 *
 * SCIM keys `/Users/{id}` off the per-org external id, NOT `User.id` — the SSO
 * callback rewrites `User.id` to the Supabase auth UUID on first login, which
 * would stale every id the IdP cached. The mapping row also PERSISTS across
 * deactivation (a deactivated user keeps its mapping but loses its
 * `UserOrganization`), so lookups resolve against the mapping and `active` is
 * derived separately from membership. A missing mapping — never provisioned, or
 * hard-deleted by a SCIM DELETE — is a 404.
 *
 * Returns the SCIM projection plus:
 *  - `userOrganizations` filtered to the org (0 or 1) — drives `active`, and
 *    whether reactivation must (re)grant membership;
 *  - `_count.userOrganizations` — TOTAL memberships, for the shared-identity guard.
 *
 * @throws {ScimError} 404 when no SCIM mapping exists for (org, scimId).
 */
async function findScimResourceOrThrow(organizationId: string, scimId: string) {
  const mapping = await db.userScimExternalId.findUnique({
    where: {
      organizationId_scimExternalId: {
        organizationId,
        scimExternalId: scimId,
      },
    },
    select: {
      user: {
        select: {
          ...scimUserSelect(organizationId),
          userOrganizations: {
            where: { organizationId },
            select: { id: true },
          },
          _count: { select: { userOrganizations: true } },
        },
      },
    },
  });

  if (!mapping) {
    throw new ScimError("User not found", 404);
  }

  return mapping.user;
}

/**
 * Grants (or re-grants) org membership to a SCIM user: creates the
 * `UserOrganization` at the SCIM default role and ensures a team member exists.
 * Used when attaching a user at provision time and when reactivating a
 * previously deactivated user (`active: true`). Roles are otherwise reconciled
 * from the IdP's group mappings on the user's next SSO login.
 *
 * The team member is reused when one is already linked (see
 * {@link revokeScimMembership}, which keeps the link across a soft deactivate).
 * Creating a second one would duplicate the person in the org's team list and
 * strand their custody/booking history on the old row.
 */
async function grantScimMembership(
  userId: string,
  organizationId: string,
  displayName: string
): Promise<void> {
  await db.userOrganization.create({
    data: {
      userId,
      organizationId,
      roles: [OrganizationRoles.SELF_SERVICE],
    },
  });

  const existingTeamMember = await db.teamMember.findFirst({
    where: { userId, organizationId, deletedAt: null },
    select: { id: true },
  });

  if (existingTeamMember) {
    // The id is server-derived from the org-scoped findFirst above, but keep
    // `organizationId` in the where clause per the org-scope IDOR convention
    // for org-scoped tables — it costs nothing and survives refactors.
    await db.teamMember.update({
      where: { id: existingTeamMember.id, organizationId },
      data: { name: displayName },
    });
    return;
  }

  await createTeamMember({ name: displayName, organizationId, userId });
}

/**
 * Removes a SCIM user's access to one org, for both soft deactivation
 * (`active: false`) and the full DELETE deprovision.
 *
 * Delegates to `revokeAccessToOrganization`, which deletes the
 * `UserOrganization` AND disconnects the `TeamMember` (leaving the row behind so
 * booking and custody history survives). Disconnecting matters beyond tidiness:
 * a `TeamMember` with no linked user is how the rest of the codebase recognises
 * revoked access. Notification paths — asset reminders and booking recipients —
 * read straight through `TeamMember.user` with no membership check, so a
 * deactivated user who kept that link would carry on receiving emails
 * containing this org's data.
 *
 * The cost is that reactivation provisions a NEW team member rather than
 * reconnecting the old one, so the person's prior custody and booking history
 * stays on the orphaned row. Accepted deliberately: a duplicate row is a
 * cosmetic and reporting problem, whereas emailing tenant data to someone who
 * has been deprovisioned is a disclosure. Resolving it properly means recording
 * the team member on the SCIM mapping so reactivation can reconnect the exact
 * row — deferred to the SCIM lifecycle-state work.
 *
 * @param userId - The Shelf user losing access
 * @param organizationId - The org the SCIM token is scoped to
 */
async function revokeScimMembership(
  userId: string,
  organizationId: string
): Promise<void> {
  await revokeAccessToOrganization({ userId, organizationId });
}

/**
 * Interprets a SCIM `active` value from a PATCH operation.
 *
 * IdPs are inconsistent about the type: Okta sends real booleans, Entra ID
 * sends the strings `"True"`/`"False"`, and others send lowercase
 * `"true"`/`"false"`. Comparing against a single spelling resolves every other
 * form to "not active" — so an *activation* request would silently deactivate
 * the user, which is the dangerous direction to get wrong.
 *
 * @param value - The raw `value` from the SCIM operation
 * @returns `true`/`false` for a recognised value, or `undefined` when it is
 *   absent or unrecognised, so the caller leaves the active state untouched
 *   rather than guessing.
 */
function parseScimActiveValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  return undefined;
}

/**
 * Applies the SHARED, cross-org identity fields — email (+ Supabase auth) and
 * first/last name — but ONLY when this org is the user's sole membership.
 *
 * The global `User` row and Supabase auth identity are shared by every org the
 * user belongs to. A SCIM client scoped to one org must never rewrite them for
 * a user who also belongs to another org: doing so would re-identify that user
 * for the other org (the review item #1 vulnerability). For a multi-org user
 * the write is skipped and logged; org-scoped attributes (team member name,
 * external id, membership) are the caller's responsibility and always applied.
 *
 * This is the single owner of the "sole-org" predicate so it can't drift
 * between the PUT and PATCH paths. PUT vs PATCH semantics are expressed through
 * the field values:
 *  - `undefined` → leave the field untouched (PATCH omits unchanged fields);
 *  - `null` / string → write it (PUT replaces all attributes, clearing to null).
 *
 * @returns `true` when this org may mutate the global identity (sole-org), so
 *   the caller can treat a supplied `newEmail` as the user's effective email.
 */
async function applyGlobalIdentity(args: {
  userId: string;
  organizationId: string;
  currentEmail: string;
  orgMembershipCount: number;
  newEmail?: string;
  newFirstName?: string | null;
  newLastName?: string | null;
  operation: "PUT" | "PATCH";
}): Promise<boolean> {
  const {
    userId,
    organizationId,
    currentEmail,
    orgMembershipCount,
    newEmail,
    newFirstName,
    newLastName,
    operation,
  } = args;

  const canMutateGlobalIdentity = orgMembershipCount <= 1;

  if (!canMutateGlobalIdentity) {
    if (
      newEmail !== undefined ||
      newFirstName !== undefined ||
      newLastName !== undefined
    ) {
      Logger.info(
        `SCIM ${operation} for org ${organizationId}: skipping global identity mutation for user ${userId} who belongs to multiple organizations`
      );
    }
    return canMutateGlobalIdentity;
  }

  // Email change goes through the helper (uniqueness check + Supabase sync).
  if (newEmail !== undefined && newEmail !== currentEmail) {
    await updateUserEmail(userId, currentEmail, newEmail);
  }

  const data: Prisma.UserUpdateInput = {};
  if (newFirstName !== undefined) data.firstName = newFirstName;
  if (newLastName !== undefined) data.lastName = newLastName;
  if (Object.keys(data).length > 0) {
    await db.user.update({ where: { id: userId }, data });
  }

  return canMutateGlobalIdentity;
}

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

  // SCIM only manages users it has provisioned — those with a mapping row for
  // this org. Scope by the mapping (not by membership) so a deactivated user
  // (mapping present, no membership) still appears with `active: false`.
  const where: Prisma.UserWhereInput = {
    scimExternalIds: { some: { organizationId } },
  };

  if (params.filter) {
    const parsed = parseScimFilter(params.filter);

    // A filter was requested but couldn't be parsed. Returning the full,
    // unfiltered list here would be dangerous: IdPs use `GET ?filter=...` as an
    // existence check and act on `Resources[0]`, so a silently-ignored filter
    // could make them mutate/deprovision the WRONG user. Reject instead.
    if (!parsed) {
      throw new ScimError(
        `Unsupported filter: ${params.filter}`,
        400,
        "invalidFilter"
      );
    }

    // We only support equality on the two attributes Entra ID uses for its
    // existence checks. Anything else is rejected for the same reason.
    if (parsed.operator === "eq" && parsed.attribute === "username") {
      where.email = { equals: parsed.value, mode: "insensitive" };
    } else if (parsed.operator === "eq" && parsed.attribute === "externalid") {
      // Filter within the org-scoped relation to avoid cross-org leakage
      where.scimExternalIds = {
        some: { organizationId, scimExternalId: parsed.value },
      };
    } else {
      throw new ScimError(
        `Unsupported filter: ${params.filter}`,
        400,
        "invalidFilter"
      );
    }
  }

  // Include the org-scoped membership so `active` can be derived per user.
  const listSelect = {
    ...scimUserSelect(organizationId),
    userOrganizations: {
      where: { organizationId },
      select: { id: true },
    },
  } satisfies Prisma.UserSelect;

  const [users, totalResults] = await Promise.all([
    db.user.findMany({
      where,
      select: listSelect,
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
    Resources: users.map((u) =>
      userToScimResource(u, u.userOrganizations.length > 0)
    ),
  };
}

// ──────────────────────────────────────────────
// GET
// ──────────────────────────────────────────────

export async function getScimUser(
  organizationId: string,
  scimId: string
): Promise<ScimUser> {
  const user = await findScimResourceOrThrow(organizationId, scimId);

  // `active` is derived: a member has access, a deactivated user does not.
  return userToScimResource(user, user.userOrganizations.length > 0);
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

  // The SCIM resource id IS the IdP's external id, so it is mandatory. Entra
  // and Okta always send it; without it we'd have no stable id to key on.
  const externalId = input.externalId;
  if (!externalId) {
    throw new ScimError(
      "externalId is required for SCIM provisioning",
      400,
      "invalidValue"
    );
  }

  // Gate provisioning to the org's own verified SSO domain. This blocks both
  // provisioning of an unrelated-domain user AND attaching/re-identifying an
  // existing Shelf user who belongs to a different organization.
  await assertEmailAllowedForOrg(organizationId, email);

  const firstName = input.name?.givenName ?? null;
  const lastName = input.name?.familyName ?? null;
  const displayName = [firstName, lastName].filter(Boolean).join(" ") || email;

  // An IdP may provision a user who is already suspended. RFC 7643 §4.1 treats
  // `active: false` as "unable to log in", so such a user must be created
  // WITHOUT org membership — otherwise provisioning a disabled account hands it
  // working access. Absent `active` means active, per the spec's default.
  const shouldBeActive = input.active !== false;

  // Check if user already exists in Shelf DB
  const existingUser = await db.user.findUnique({
    where: { email },
    select: {
      ...scimUserSelect(organizationId),
      userOrganizations: {
        where: { organizationId },
        select: { id: true },
      },
    },
  });

  if (existingUser) {
    // Already SCIM-provisioned in this org (has a mapping) -> 409 conflict.
    if (existingUser.scimExternalIds.length > 0) {
      throw new ScimError(
        `User with userName "${email}" already exists in this organization`,
        409,
        "uniqueness"
      );
    }

    // Exists but not yet SCIM-managed here. Adopt them by creating the mapping
    // (covers an existing SSO/invite member the IdP now manages) and reconcile
    // their access to the requested `active` state. We never mutate the global
    // identity here (see #1).
    //
    // Adoption makes SCIM authoritative for this user in this org, so the
    // returned lifecycle state must match what was requested — an inactive
    // resource must not have access (RFC 7643 §4.1), whether it was newly
    // created or adopted:
    //  - inactive + not a member  → stay without access;
    //  - inactive + existing member → revoke, so we don't return active:true;
    //  - active + not a member    → grant.
    let hasMembership = existingUser.userOrganizations.length > 0;
    if (!hasMembership && shouldBeActive) {
      await grantScimMembership(existingUser.id, organizationId, displayName);
      hasMembership = true;
    } else if (hasMembership && !shouldBeActive) {
      await revokeScimMembership(existingUser.id, organizationId);
      hasMembership = false;
    }
    await createScimMapping(existingUser.id, organizationId, externalId, email);

    const updatedUser = await db.user.findUniqueOrThrow({
      where: { id: existingUser.id },
      select: scimUserSelect(organizationId),
    });

    return userToScimResource(updatedUser, hasMembership);
  }

  // User doesn't exist — create in Shelf DB only.
  // We do NOT create a Supabase auth account here. When the user signs in
  // via SSO, the SSO callback will create the auth account and link it
  // to this Shelf user by updating the user ID.
  //
  // A random suffix is appended to the email local-part to avoid collisions
  // across SCIM orgs that provision users with the same local-part
  // (e.g. two orgs both provisioning `jane@…`).
  const placeholderId = randomUUID();
  const username = randomUsernameFromEmail(email);

  // The check-then-create above can race with a concurrent SCIM POST for the
  // same email. Catch Prisma's unique-constraint violation and surface it as
  // the SCIM-spec 409 "uniqueness" error rather than a generic 500.
  let newUser;
  try {
    newUser = await createUser({
      userId: placeholderId,
      email,
      username,
      firstName,
      lastName,
      organizationId,
      // Empty roles make `createUser` skip the UserOrganization association, so
      // an inactive user lands in exactly the state deactivation produces:
      // mapping present, no membership, no access.
      roles: shouldBeActive ? [OrganizationRoles.SELF_SERVICE] : [],
      isSSO: true,
      skipPersonalOrg: true,
    });
  } catch (err) {
    throwScimUniquenessIfP2002(err, duplicateUserDetail(email));
  }

  await createScimMapping(newUser.id, organizationId, externalId, email);

  // No team member for an inactive user: a linked TeamMember is what the
  // notification paths read to decide who receives this org's emails.
  if (shouldBeActive) {
    await createTeamMember({
      name: displayName,
      organizationId,
      userId: newUser.id,
    });
  }

  const createdUser = await db.user.findUniqueOrThrow({
    where: { id: newUser.id },
    select: scimUserSelect(organizationId),
  });

  return userToScimResource(createdUser, shouldBeActive);
}

// ──────────────────────────────────────────────
// REPLACE (PUT)
// ──────────────────────────────────────────────

export async function replaceScimUser(
  organizationId: string,
  scimId: string,
  input: ScimUserInput
): Promise<ScimUser> {
  // Resolve by the stable SCIM id (external id). The mapping persists across
  // deactivation, so a deactivated user still resolves here and can be
  // reactivated via `active: true`.
  const user = await findScimResourceOrThrow(organizationId, scimId);

  const newEmail = (input.userName || input.emails?.[0]?.value)?.toLowerCase();
  const firstName = input.name?.givenName ?? null;
  const lastName = input.name?.familyName ?? null;
  // NOTE: externalId is the immutable SCIM resource id and is NOT updated here.

  // Gate any email in the payload to the org's verified SSO domain.
  if (newEmail) {
    await assertEmailAllowedForOrg(organizationId, newEmail);
  }

  // Apply the shared global identity only for a sole-org user (see helper).
  // PUT replace semantics: names are always written (null clears them).
  const canMutateGlobalIdentity = await applyGlobalIdentity({
    userId: user.id,
    organizationId,
    currentEmail: user.email,
    orgMembershipCount: user._count.userOrganizations,
    newEmail,
    newFirstName: firstName,
    newLastName: lastName,
    operation: "PUT",
  });

  // The new email only takes effect for a sole-org user; otherwise the global
  // email is unchanged.
  const effectiveEmail = (canMutateGlobalIdentity && newEmail) || user.email;
  const displayName =
    [firstName, lastName].filter(Boolean).join(" ") || effectiveEmail;

  // Reconcile membership with the desired active state (state, not deletion):
  // deactivate → drop membership, keeping the mapping AND the team member link;
  // reactivate → re-grant.
  const isCurrentlyActive = user.userOrganizations.length > 0;
  const shouldBeActive = input.active !== false;

  if (isCurrentlyActive && !shouldBeActive) {
    await revokeScimMembership(user.id, organizationId);
  } else if (!isCurrentlyActive && shouldBeActive) {
    await grantScimMembership(user.id, organizationId, displayName);
  } else if (isCurrentlyActive) {
    // Still active — just sync the org-scoped team member name.
    await db.teamMember.updateMany({
      where: { userId: user.id, organizationId },
      data: { name: displayName },
    });
  }

  const updatedUser = await findScimResourceOrThrow(organizationId, scimId);
  return userToScimResource(
    updatedUser,
    updatedUser.userOrganizations.length > 0
  );
}

// ──────────────────────────────────────────────
// PATCH
// ──────────────────────────────────────────────

export async function patchScimUser(
  organizationId: string,
  scimId: string,
  patchOp: ScimPatchOp
): Promise<ScimUser> {
  const user = await findScimResourceOrThrow(organizationId, scimId);

  // Intended attribute values gathered from the operation list. Kept as plain
  // locals (rather than a Prisma update object) so the shared-identity guard
  // below can decide independently which of them reach the global User row.
  let newEmail: string | undefined;
  let newFirstName: string | undefined;
  let newLastName: string | undefined;
  // Desired active state, if any op set it. Applied after the loop as a
  // membership grant/revoke.
  let activeIntent: boolean | undefined;

  for (const op of patchOp.Operations) {
    // Entra sends title-cased ops ("Replace", "Add"); normalise for comparison.
    // Only "replace" and "add" mutate attributes — "remove"/unknown are ignored.
    const opType = op.op?.toLowerCase();
    if (opType !== "replace" && opType !== "add") {
      continue;
    }

    if (op.path === "active") {
      // Leave the intent untouched on an unrecognised value rather than
      // defaulting to "deactivate" (see parseScimActiveValue).
      activeIntent = parseScimActiveValue(op.value) ?? activeIntent;
    } else if (op.path === "userName") {
      newEmail = String(op.value ?? "").toLowerCase();
    } else if (op.path === "name.givenName") {
      newFirstName = String(op.value ?? "");
    } else if (op.path === "name.familyName") {
      newLastName = String(op.value ?? "");
    } else if (!op.path && typeof op.value === "object" && op.value !== null) {
      // Path-less op: attributes live as keys of the value object.
      // e.g. { op: "Replace", value: { active: false } } or
      //      { op: "Add", value: { name: { givenName: "Jane" } } }
      const val = op.value as Record<string, unknown>;

      if ("active" in val) {
        activeIntent = parseScimActiveValue(val.active) ?? activeIntent;
      }
      // Nested name object: { name: { givenName, familyName } }
      if ("name" in val && typeof val.name === "object" && val.name !== null) {
        const name = val.name as Record<string, unknown>;
        if ("givenName" in name) newFirstName = String(name.givenName ?? "");
        if ("familyName" in name) newLastName = String(name.familyName ?? "");
      }
      // Flat dotted keys: { "name.givenName": "Jane" }
      if ("name.givenName" in val) {
        newFirstName = String(val["name.givenName"] ?? "");
      }
      if ("name.familyName" in val) {
        newLastName = String(val["name.familyName"] ?? "");
      }
      if ("userName" in val) {
        newEmail = String(val.userName ?? "").toLowerCase();
      }
    }
    // NOTE: externalId is the immutable SCIM resource id and is intentionally
    // NOT updatable via PATCH.
  }

  // Gate any email in the payload to the org's verified SSO domain.
  if (newEmail !== undefined && newEmail !== user.email) {
    await assertEmailAllowedForOrg(organizationId, newEmail);
  }

  // Apply the shared global identity only for a sole-org user (see helper).
  // PATCH partial semantics: only fields present in the ops are written.
  const canMutateGlobalIdentity = await applyGlobalIdentity({
    userId: user.id,
    organizationId,
    currentEmail: user.email,
    orgMembershipCount: user._count.userOrganizations,
    newEmail,
    newFirstName,
    newLastName,
    operation: "PATCH",
  });

  const effectiveFirstName = newFirstName ?? user.firstName;
  const effectiveLastName = newLastName ?? user.lastName;
  const effectiveEmail = (canMutateGlobalIdentity && newEmail) || user.email;
  const displayName =
    [effectiveFirstName, effectiveLastName].filter(Boolean).join(" ") ||
    effectiveEmail;

  // Reconcile membership with the desired active state (state, not deletion):
  // deactivate → drop membership, keeping the mapping AND the team member link;
  // reactivate → re-grant.
  const isCurrentlyActive = user.userOrganizations.length > 0;
  if (activeIntent === false && isCurrentlyActive) {
    await revokeScimMembership(user.id, organizationId);
  } else if (activeIntent === true && !isCurrentlyActive) {
    await grantScimMembership(user.id, organizationId, displayName);
  } else if (
    isCurrentlyActive &&
    (newFirstName !== undefined || newLastName !== undefined)
  ) {
    // Still active and a name changed → sync the org-scoped team member name.
    // (A reactivation grant already sets the name; a revoke has no member.)
    await db.teamMember.updateMany({
      where: { userId: user.id, organizationId },
      data: { name: displayName },
    });
  }

  const updatedUser = await findScimResourceOrThrow(organizationId, scimId);
  return userToScimResource(
    updatedUser,
    updatedUser.userOrganizations.length > 0
  );
}

// ──────────────────────────────────────────────
// DEACTIVATE (DELETE)
// ──────────────────────────────────────────────

export async function deactivateScimUser(
  organizationId: string,
  scimId: string
): Promise<void> {
  // Unlike PATCH `active: false` (soft — keeps the mapping and the team member
  // link so the resource can be reactivated), DELETE is a full per-org
  // deprovision: revoke access AND remove the SCIM mapping so the id no longer
  // resolves (later GET → 404).
  const user = await findScimResourceOrThrow(organizationId, scimId);

  // Access removal is identical to `active: false` — what makes DELETE a full
  // deprovision is dropping the mapping below, so the id stops resolving.
  if (user.userOrganizations.length > 0) {
    await revokeScimMembership(user.id, organizationId);
  }

  // Remove the SCIM identity. The global User row is intentionally left intact —
  // it's a shared identity that may belong to other orgs or have an auth account.
  await db.userScimExternalId.deleteMany({
    where: { organizationId, scimExternalId: scimId },
  });

  // NOTE: We intentionally do not invalidate Supabase sessions here.
  // `@supabase/auth-js` only exposes `admin.signOut(jwt, scope)`, which
  // requires a JWT rather than a userId — we have no JWT in SCIM context.
  // The deprovisioned user keeps a valid access token until it expires
  // (~1h), but every Shelf loader/action re-checks org membership against
  // `userOrganization`, so the stale session cannot access this org's data.
  // Revisit if Supabase adds an admin "sign out by userId" API.
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

/**
 * Updates a user's email in both Shelf DB and Supabase auth.
 * Throws 409 if the new email is already taken by another user.
 * Silently skips the Supabase auth update for SCIM-provisioned users
 * who haven't logged in yet (no Supabase auth account).
 *
 * @throws {ScimError} 409 `uniqueness` if the address is already taken —
 *   whether detected by the pre-check or by the database constraint.
 */
async function updateUserEmail(
  userId: string,
  currentEmail: string,
  newEmail: string
): Promise<void> {
  if (newEmail === currentEmail) return;

  const conflictDetail = `Email "${newEmail}" is already in use`;

  const conflict = await db.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });

  if (conflict) {
    throw new ScimError(conflictDetail, 409, "uniqueness");
  }

  // The check above can lose a race to a concurrent request claiming the same
  // address, in which case `User.email`'s unique constraint rejects the write.
  // Translate that to the same 409 the pre-check returns: a 500 here would look
  // like a transient fault, so the IdP would keep retrying a request that can
  // never succeed.
  try {
    await db.user.update({
      where: { id: userId },
      data: { email: newEmail },
    });
  } catch (err) {
    throwScimUniquenessIfP2002(err, conflictDetail);
  }

  // Update Supabase auth email if the user has an auth account.
  // SCIM-provisioned users who haven't logged in via SSO yet won't
  // have one, so we silently skip on error.
  try {
    await getSupabaseAdmin().auth.admin.updateUserById(userId, {
      email: newEmail,
    });
  } catch {
    // No Supabase auth account — expected for pre-SSO users
  }
}
