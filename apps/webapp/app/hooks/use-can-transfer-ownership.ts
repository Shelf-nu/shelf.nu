import { useIsShelfAdmin } from "~/hooks/use-is-shelf-admin";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";

/**
 * Whether the viewer may run the workspace ownership transfer.
 *
 * Mirrors the rule the server enforces in `transferOwnership` — workspace
 * OWNER, or a Shelf staff admin — and is **UI-cosmetic only**: the service
 * re-checks both independently, so nothing security-bearing hangs on this.
 *
 * Named once because the two surfaces that gate on it live on different pages
 * (Settings → Team → Users, and Settings → General). If they disagree, a user
 * sees a live "Transfer ownership" link on one page and "only the workspace
 * owner can transfer" on the other.
 *
 * The staff-admin term is load-bearing, not belt-and-braces: the admin
 * dashboard renders `TransferOwnershipCard` for Shelf staff who are normally
 * **not** members of the workspace, so `isOwner` is false there and an
 * owner-only check would break that page.
 *
 * @returns `true` when the viewer may transfer ownership of the current workspace
 * @see {@link file://./../modules/organization/service.server.ts} `transferOwnership`
 * @see {@link file://./../routes/_layout+/admin-dashboard+/org.$organizationId.transfer-ownership.tsx}
 */
export function useCanTransferOwnership() {
  const { isOwner } = useUserRoleHelper();
  const isShelfAdmin = useIsShelfAdmin();

  return isOwner || isShelfAdmin;
}
