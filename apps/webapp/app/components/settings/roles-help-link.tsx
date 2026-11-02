/**
 * Roles Help Link
 *
 * The "Learn more about roles" link shown under every role picker, and the
 * knowledge-base URL it opens. Anything else that points people at the roles
 * article (the team settings pages) reads `ROLES_HELP_URL` from here, so the
 * article has one address in the webapp.
 *
 * @see {@link file://./invite-user-dialog.tsx}
 * @see {@link file://./../workspace/change-role-dialog.tsx}
 */

/** The knowledge-base article that explains what every role may do. */
export const ROLES_HELP_URL =
  "https://www.shelf.nu/knowledge-base/user-roles-and-their-permissions";

/**
 * Opens the roles article in a new tab. Screen readers hear that it opens a
 * new tab, since nothing else on the link says so.
 */
export function RolesHelpLink() {
  return (
    <a
      href={ROLES_HELP_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-1 inline-block text-sm font-semibold text-primary-700 hover:text-primary-800"
    >
      Learn more about roles
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
