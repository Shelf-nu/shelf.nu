/**
 * Log Out User Dialog
 *
 * Confirmation for "Log out of Shelf", the forced logout an owner or admin of
 * an SSO workspace uses when a member's role changed in the identity provider.
 * SSO roles are applied at sign-in, so ending the member's sessions makes the
 * new role take effect on their next sign-in instead of whenever they choose
 * to log out.
 *
 * Confirming posts `intent=logoutUser` to the current route's action
 * (`resolveUserAction`), which ends every session the member has, on every
 * device. The dialog closes on success; a refusal renders inside it.
 *
 * @see {@link file://./users-actions-dropdown.tsx}
 * @see {@link file://./../../modules/user/utils.server.ts}
 */
import { useEffect } from "react";
import type { User } from "@prisma/client";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
import { useFetcherOutcomeSinceOpen } from "~/hooks/use-fetcher-error-since-open";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";

/**
 * Confirmation dialog for logging a member out of Shelf on every device.
 *
 * @param props.userId - The member whose sessions end on confirm
 * @param props.name - The member's display name; the email identifies them when absent
 * @param props.email - The member's email, always shown so the admin can double-check
 * @param props.open - Controlled open state
 * @param props.onOpenChange - Controlled open state setter
 */
export function LogoutUserDialog({
  userId,
  name,
  email,
  open,
  onOpenChange,
}: {
  userId: User["id"];
  name?: string;
  email: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /** Keyed per member: the list and the member page can mount this dialog for several people. */
  const fetcher = useFetcher({ key: `logout-user-${userId}` });
  const disabled = useDisabled(fetcher);
  /** Only a response to this opening counts, never one left from an earlier one. */
  const outcome = useFetcherOutcomeSinceOpen(fetcher, open);

  /** Close once the logout went through. */
  useEffect(() => {
    if (outcome.status === "accepted") onOpenChange(false);
  }, [outcome.status, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent aria-describedby="logout-user-description">
        <AlertDialogHeader>
          <AlertDialogTitle>Log out of Shelf</AlertDialogTitle>
          <AlertDialogDescription id="logout-user-description">
            You are about to log out{" "}
            <strong>{name ? `${name} (${email})` : email}</strong>. They are
            signed out of Shelf on every device, including the mobile app, and
            must sign in again through your identity provider. Their role is
            refreshed from your identity provider when they do.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="logoutUser" />
          <input type="hidden" name="userId" value={userId} />

          {outcome.message ? (
            <p className="mt-3 text-sm text-error-500" role="alert">
              {outcome.message}
            </p>
          ) : null}

          <AlertDialogFooter className="mt-4 flex items-center gap-2">
            <Button
              variant="secondary"
              className="flex-1"
              type="button"
              disabled={disabled}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              className="flex-1"
              disabled={disabled}
            >
              {disabled ? "Logging out..." : "Log out"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
