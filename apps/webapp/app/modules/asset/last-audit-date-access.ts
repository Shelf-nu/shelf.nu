/**
 * Last audit date column access rule.
 *
 * Pure helpers that decide how the "Last audit date" column of the advanced
 * assets index behaves for the current user and workspace. The value is
 * derived from audits, so it follows audit visibility and availability.
 *
 * @see {@link file://./../asset-index-settings/helpers.ts}
 */

/** Settings column name of the last audit date column. */
export const LAST_AUDIT_DATE_COLUMN = "lastAuditDate" as const;

/**
 * How the last audit date column is exposed:
 * - `available`: shown and queryable
 * - `locked`: shown as a locked placeholder, never queried
 * - `hidden`: removed from the column list entirely
 */
export type LastAuditDateAccess = "available" | "locked" | "hidden";

/**
 * Resolves the access level of the last audit date column.
 *
 * @param args.seeAllAudits - Whether the user's role may see audits across the workspace
 * @param args.auditsUsable - Whether audits are enabled and usable for the workspace
 * @returns `hidden` without audit visibility, else `locked` when audits are unusable, else `available`
 */
export function resolveLastAuditDateAccess(args: {
  seeAllAudits: boolean;
  auditsUsable: boolean;
}): LastAuditDateAccess {
  if (!args.seeAllAudits) return "hidden";
  if (!args.auditsUsable) return "locked";
  return "available";
}

/**
 * Removes the last audit date column when access is `hidden`; otherwise
 * returns the columns unchanged.
 *
 * @param columns - Columns identified by `name`
 * @param access - The resolved access level
 * @returns The columns allowed for this access level
 */
export function stripHiddenAuditColumns<T extends { name: string }>(
  columns: T[],
  access: LastAuditDateAccess
): T[] {
  if (access !== "hidden") return columns;
  return columns.filter((column) => column.name !== LAST_AUDIT_DATE_COLUMN);
}

/**
 * Whether the last audit date may be read from the database.
 *
 * @param access - The resolved access level
 * @returns `true` only when access is `available`
 */
export function canQueryLastAuditDate(access: LastAuditDateAccess): boolean {
  return access === "available";
}
