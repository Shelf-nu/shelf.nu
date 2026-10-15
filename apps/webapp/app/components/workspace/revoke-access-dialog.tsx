import type { User } from "@prisma/client";
import { useFetcher } from "react-router";
import { useDisabled } from "~/hooks/use-disabled";
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
 * Confirmation dialog for revoking a registered team member's access to the
 * current workspace.
 *
 * Opened by the "Revoke access" item in {@link TeamUsersActionsDropdown},
 * which renders it next to {@link ChangeRoleDialog}. Confirming posts
 * `intent=revokeAccess` to the current route's action (`resolveUserAction`),
 * which removes the membership, keeps the team-member record and its history,
 * and emails the affected user. On success the action redirects to the team
 * users list, so the dialog unmounts with the page; on failure the error
 * message renders inside the dialog.
 *
 * @param userId - The user whose workspace access is revoked on confirm
 * @param name - The user's display name; the email identifies them when absent
 * @param email - The user's email, always shown so the admin can double-check
 * @param isSSO - Shows a note that SSO group mappings can re-grant access
 * @param open - Controlled open state
 * @param onOpenChange - Controlled open state setter
 */
export function RevokeAccessDialog({
  userId,
  name,
  email,
  isSSO,
  open,
  onOpenChange,
}: {
  userId: User["id"];
  name?: string;
  email: string;
  isSSO: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const fetcher = useFetcher<{ error?: { message: string } }>();
  const disabled = useDisabled(fetcher);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent aria-describedby="revoke-access-description">
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke access</AlertDialogTitle>
          <AlertDialogDescription id="revoke-access-description">
            You are about to revoke{" "}
            <strong>{name ? `${name} (${email})` : email}</strong>&apos;s access
            to this workspace. They can no longer open it and are notified by
            email. Their team member record and history are kept, and you can
            invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="revokeAccess" />
          <input type="hidden" name="userId" value={userId} />

          {isSSO ? (
            <div className="mt-3 rounded-md border border-warning-200 bg-warning-25 p-3">
              <p className="text-sm text-warning-700">
                This user signs in via SSO. If workspace membership is assigned
                from SSO groups, they regain access on their next sign-in unless
                they are also removed from the mapped group in your identity
                provider.
              </p>
            </div>
          ) : null}

          {fetcher.data?.error ? (
            <p className="mt-3 text-sm text-error-500">
              {fetcher.data.error.message}
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
              {disabled ? "Revoking..." : "Revoke access"}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
