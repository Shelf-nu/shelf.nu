import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useIsShelfAdmin } from "~/hooks/use-is-shelf-admin";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { Button } from "../shared/button";

/**
 * Header affordance for the ownership-transfer flow on Settings → Team.
 *
 * The flow itself lives on the general settings page
 * (`/settings/general#transfer-ownership`); this button only makes it
 * discoverable from the place where people manage their team. It renders next
 * to "Import Users" / "Invite a user" so it reads as a page-level action, not
 * a row action.
 *
 * - Workspace owner (and Shelf staff admins, via {@link useIsShelfAdmin} —
 *   the same gate TransferOwnershipCard uses) get a link to the transfer
 *   section.
 * - Everyone else gets a disabled button whose hover reason names the owner,
 *   so admins learn who can run the transfer instead of the feature being
 *   invisible to them.
 *
 * @see {@link file://./transfer-ownership-card.tsx}
 */
export default function TransferOwnershipButton() {
  const { isOwner } = useUserRoleHelper();
  const isShelfAdmin = useIsShelfAdmin();
  const currentOrganization = useCurrentOrganization();

  /** Shown to non-owners so they know who to ask */
  const ownerEmail = currentOrganization?.owner?.email;

  // No width/margin classes on either branch: the actions row that renders
  // this owns the layout (see settings.team.users).
  if (isOwner || isShelfAdmin) {
    return (
      <Button to="/settings/general#transfer-ownership" variant="secondary">
        <span className="whitespace-nowrap">Transfer ownership</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      disabled={{
        reason: `Only the workspace owner${
          ownerEmail ? ` (${ownerEmail})` : ""
        } can transfer ownership of this workspace.`,
      }}
    >
      <span className="whitespace-nowrap">Transfer ownership</span>
    </Button>
  );
}
