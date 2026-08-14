import { Roles } from "@prisma/client";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserData } from "~/hooks/use-user-data";
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
 * - Workspace owner (and Shelf staff admins, matching the isShelfAdmin check
 *   in TransferOwnershipCard) get a link to the transfer section.
 * - Everyone else gets a disabled button whose hover reason names the owner,
 *   so admins learn who can run the transfer instead of the feature being
 *   invisible to them.
 *
 * @see {@link file://./transfer-ownership-card.tsx}
 */
export default function TransferOwnershipButton() {
  const { isOwner } = useUserRoleHelper();
  const user = useUserData();
  const currentOrganization = useCurrentOrganization();

  const isShelfAdmin = user?.roles?.some((role) => role.name === Roles.ADMIN);

  /** Shown to non-owners so they know who to ask */
  const ownerEmail = currentOrganization?.owner?.email;

  if (isOwner || isShelfAdmin) {
    return (
      <Button
        to="/settings/general#transfer-ownership"
        variant="secondary"
        className="mt-2 w-full md:mt-0 md:w-max"
      >
        <span className="whitespace-nowrap">Transfer ownership</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      className="mt-2 w-full md:mt-0 md:w-max"
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
