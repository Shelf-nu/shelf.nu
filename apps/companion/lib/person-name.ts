/**
 * Display-name resolution for the people the API returns.
 *
 * MIRROR of `resolveUserDisplayName` in
 * `apps/webapp/app/utils/user.ts` — the companion cannot import from
 * `apps/webapp/app/**` (Remix-internal paths Metro can't consume). It encodes
 * the same precedence the server uses, so a person is named identically on both
 * clients: `displayName` when set, otherwise `firstName lastName`.
 *
 * Two deliberate differences from the webapp original:
 * - returns `null` rather than `""` for "no name", so callers can fall back
 *   with `??` and render nothing at all;
 * - trims each part before joining, so a user with only a first name is
 *   `"Carlos"` and never `" Carlos"`.
 *
 * Cosmetic only — nothing is gated on this.
 *
 * Migrated call sites so far: the booking detail screen (creator + custodian).
 * The same join is still hand-rolled, untrimmed and displayName-blind in
 * `app/(tabs)/audits/[id].tsx`, `app/(tabs)/settings.tsx`,
 * `app/(tabs)/scanner.tsx`, `app/(tabs)/assets/[id].tsx`,
 * `app/(tabs)/assets/kits/[id].tsx`, `components/team-member-picker.tsx` and
 * `components/asset-detail/notes-section.tsx`. Converting those needs the
 * matching `displayName` added to each route's payload, so it is tracked
 * separately rather than done blind here.
 */

/** The name-bearing subset of a user, as the mobile API returns it. */
type PersonNameParts = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
};

/**
 * Resolves the name to show for a person.
 *
 * @param person - The user's name fields; `null`/`undefined` is tolerated so
 *   call sites don't need their own guard for an absent custodian or creator
 * @returns The display name, or `null` when the person has no usable name
 */
export function formatPersonName(
  person?: PersonNameParts | null
): string | null {
  if (!person) return null;

  const displayName = person.displayName?.trim();
  if (displayName) return displayName;

  return (
    [person.firstName, person.lastName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(" ") || null
  );
}
