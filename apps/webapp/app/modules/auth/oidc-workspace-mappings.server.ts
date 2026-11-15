/**
 * OIDC Workspace Mappings
 *
 * Parses `OIDC_WORKSPACE_MAPPINGS`, the configuration that maps the groups a
 * custom OIDC provider asserts to workspace roles, and answers which role a
 * set of groups holds in one mapped workspace.
 *
 * The configuration is a JSON array with one entry per workspace:
 *
 * ```json
 * [
 *   {
 *     "key": "it-department",
 *     "name": "IT Department",
 *     "currency": "EUR",
 *     "roles": {
 *       "ADMIN": ["it-admins"],
 *       "SELF_SERVICE": ["it-staff"],
 *       "BASE": ["all-employees"]
 *     }
 *   }
 * ]
 * ```
 *
 * `key` is the stable identity of the entry and is stored on the workspace
 * (`Organization.oidcMappingKey`), so the workspace can be renamed in Shelf
 * and the entry's `name` only matters when the workspace is created.
 *
 * Pure: it reads no database and no request. The login that applies the
 * mappings lives in `oidc.server.ts`.
 *
 * @see {@link file://./oidc.server.ts}
 * @see {@link file://./../../utils/env.ts} OIDC_WORKSPACE_MAPPINGS
 */
import { Currency } from "@prisma/client";
import type { OrganizationRoles } from "@prisma/client";
import { z } from "zod";
import { OIDC_WORKSPACE_MAPPINGS } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import {
  SSO_ASSIGNABLE_ROLES,
  resolveRole,
} from "~/utils/permissions/role-access";

/** A list of group names; blank entries are dropped. */
const groupListSchema = z
  .array(z.string())
  .transform((groups) => groups.map(normalizeGroup).filter(Boolean));

/**
 * One workspace of the configuration. `roles` accepts exactly the roles a
 * group mapping may confer (`SSO_ASSIGNABLE_ROLES`): a workspace's owner is
 * never decided by a group.
 */
const mappingSchema = z
  .object({
    key: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9_-]{0,62}$/,
        "key must be 1 to 63 lowercase letters, digits, hyphens or underscores, starting with a letter or digit"
      ),
    name: z.string().trim().min(1, "name is required"),
    currency: z.nativeEnum(Currency).optional(),
    roles: z
      .object(
        Object.fromEntries(
          SSO_ASSIGNABLE_ROLES.map((role) => [role, groupListSchema.optional()])
        ) as Record<
          (typeof SSO_ASSIGNABLE_ROLES)[number],
          z.ZodOptional<typeof groupListSchema>
        >
      )
      .strict(),
  })
  .strict();

const mappingsSchema = z.array(mappingSchema).superRefine((mappings, ctx) => {
  const seen = new Set<string>();
  mappings.forEach((mapping, index) => {
    if (seen.has(mapping.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index, "key"],
        message: `key "${mapping.key}" is used more than once`,
      });
    }
    seen.add(mapping.key);
  });
});

/** One workspace of `OIDC_WORKSPACE_MAPPINGS`, validated and normalised. */
export type OidcWorkspaceMapping = z.infer<typeof mappingSchema>;

/**
 * Normalises a group name for comparison: trimmed and lowercased, the same
 * comparison the SAML group mapping uses (`getRoleFromGroupId`).
 *
 * @param group - A group name from the configuration or from the IdP
 * @returns The comparable form
 */
function normalizeGroup(group: string): string {
  return group.trim().toLowerCase();
}

/**
 * Parses and validates a raw `OIDC_WORKSPACE_MAPPINGS` value.
 *
 * @param raw - The JSON text; empty or blank means no mappings
 * @returns The validated mappings
 * @throws {ShelfError} when the value is not JSON or does not match the shape.
 *   The message names every offending field so an operator can fix it.
 */
export function parseOidcWorkspaceMappings(
  raw: string | undefined
): OidcWorkspaceMapping[] {
  if (!raw || raw.trim() === "") return [];

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (cause) {
    throw new ShelfError({
      cause,
      message: "OIDC_WORKSPACE_MAPPINGS is not valid JSON",
      label: "Environment",
    });
  }

  const result = mappingsSchema.safeParse(json);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ShelfError({
      cause: null,
      message: `OIDC_WORKSPACE_MAPPINGS is invalid. ${problems}`,
      label: "Environment",
    });
  }

  return result.data;
}

/**
 * The mappings of this deployment. Parsed once when the module loads, so a
 * malformed configuration stops the server at boot instead of failing every
 * login later.
 */
export const oidcWorkspaceMappings: OidcWorkspaceMapping[] =
  parseOidcWorkspaceMappings(OIDC_WORKSPACE_MAPPINGS);

/**
 * Whether a set of IdP groups may create the workspace of a mapping entry.
 *
 * A mapped workspace is created by its first administrator to sign in, who
 * becomes its owner. "Administrator" is the most privileged role a mapping can
 * confer, so the entry's groups for that role decide.
 *
 * @param mapping - The workspace's entry of the configuration
 * @param groups - The groups the IdP asserted for the user
 * @returns true when the user is in one of the entry's administrator groups
 */
export function canCreateMappedWorkspace(
  mapping: OidcWorkspaceMapping,
  groups: string[]
): boolean {
  const [creatorRole] = SSO_ASSIGNABLE_ROLES;
  const held = new Set(groups.map(normalizeGroup));

  return (mapping.roles[creatorRole] ?? []).some((group) => held.has(group));
}

/**
 * Resolves the role a set of IdP groups holds in one mapped workspace. When
 * the groups match several roles the most privileged one wins (`resolveRole`).
 *
 * @param mapping - The workspace's entry of the configuration
 * @param groups - The groups the IdP asserted for the user
 * @returns The role, or `null` when no group of the entry matches
 */
export function getRoleFromOidcGroups(
  mapping: OidcWorkspaceMapping,
  groups: string[]
): OrganizationRoles | null {
  const held = new Set(groups.map(normalizeGroup));

  const matched = SSO_ASSIGNABLE_ROLES.filter((role) =>
    (mapping.roles[role] ?? []).some((group) => held.has(group))
  );

  return matched.length > 0 ? resolveRole(matched) : null;
}
