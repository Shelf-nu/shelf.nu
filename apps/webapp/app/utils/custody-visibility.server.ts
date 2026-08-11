/**
 * Server-side custody redaction for list payloads.
 *
 * `selfServiceCanSeeCustody` / `baseUserCanSeeCustody` decide whether a
 * restricted role may see WHO holds an asset or kit. That rule was enforced
 * only in `TeamMemberBadge`, a client-side render check — so the badge printed
 * "private" while the loader had already shipped the custodian's name and
 * `user.email` in the payload. Reading the network response was enough to
 * bypass it.
 *
 * This is the server-side half. `assetIndexFields` / `KITS_INCLUDE_FIELDS`
 * select the custodian unconditionally (they have no role argument, and a
 * Prisma `select` cannot vary per row), so the identity is removed here, after
 * the query and before the payload leaves the loader.
 *
 * Deliberately NOT a "drop the custody relation" — see
 * `.claude/rules/permission-gated-loader-data-must-not-gate-display.md`. The
 * row has to survive so the badge can still render "private"; dropping it
 * would turn a meaningful chip into a blank cell and hide the fact that the
 * item is held at all.
 *
 * @see {@link file://./permissions/custody-and-bookings-permissions.validator.client.ts} — `userCanViewSpecificCustody`, the client-side mirror.
 */

/** The identity fields a list include selects for a custodian. */
type CustodianIdentity = {
  userId?: string | null;
  name?: string | null;
  user?: {
    id?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    displayName?: string | null;
    profilePicture?: string | null;
    email?: string | null;
  } | null;
} | null;

/** A list row carrying an optional custody relation. */
type RowWithCustody = {
  custody?:
    | ({ custodian?: CustodianIdentity } & Record<string, unknown>)
    | null;
};

/**
 * What a redacted custodian looks like on the wire.
 *
 * Every identifying field is emptied rather than removed, so the shape stays
 * stable for consumers and `TeamMemberBadge` still receives a truthy custodian
 * to render its "private" chip from.
 */
const REDACTED_CUSTODIAN = {
  userId: null,
  name: "",
  user: null,
} as const;

/**
 * Removes custodian identities the viewer is not allowed to see.
 *
 * Mirrors `userCanViewSpecificCustody`: a viewer always sees custody they hold
 * themselves, and sees everyone else's only when the workspace override is on.
 * An NRM custodian has no user to compare against, so it can never match the
 * viewer and is always redacted for a restricted role.
 *
 * @param rows - List rows straight from Prisma.
 * @param args.canSeeAllCustody - Resolved by `resolveCanSeeAllCustody`.
 * @param args.userId - The viewer.
 * @returns A shallow copy with disallowed custodian identities emptied. The
 *   input array and its rows are left untouched, because callers reuse them.
 */
export function redactCustodianForViewer<T extends RowWithCustody>(
  rows: T[],
  { canSeeAllCustody, userId }: { canSeeAllCustody: boolean; userId: string }
): T[] {
  if (canSeeAllCustody) {
    return rows;
  }

  return rows.map((row) => {
    const custodian = row.custody?.custodian;

    if (!custodian) {
      return row;
    }

    // The viewer's own custody stays visible — redacting it would show someone
    // "private" on an item they are holding.
    const isOwnCustody =
      !!userId &&
      (custodian.userId === userId || custodian.user?.id === userId);

    if (isOwnCustody) {
      return row;
    }

    return {
      ...row,
      custody: { ...row.custody, custodian: { ...REDACTED_CUSTODIAN } },
    };
  });
}
