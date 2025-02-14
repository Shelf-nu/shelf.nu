import type { ReactNode } from "react";
import type { InviteStatuses, User } from "@prisma/client";
import { useFetcher } from "@remix-run/react";
import {
  RefreshIcon,
  RemoveUserIcon,
  UserXIcon,
  VerticalDotsIcon,
} from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import type { UserFriendlyRoles } from "~/routes/_layout+/settings.team";
import { isFormProcessing } from "~/utils/form";
import { Button } from "../shared/button";
import { Spinner } from "../shared/spinner";

export function TeamUsersActionsDropdown({
  userId,
  inviteStatus,
  name,
  teamMemberId,
  email,
  isSSO,
  customTrigger,
  role,
}: {
  userId: User["id"] | null;
  inviteStatus: InviteStatuses;
  name?: string;
  teamMemberId?: string;
  email: string;
  isSSO: boolean;
  customTrigger?: (disabled: boolean) => ReactNode;
  role: UserFriendlyRoles;
}) {
  const fetcher = useFetcher();
  const disabled = isFormProcessing(fetcher.state);
  const { ref, open, setOpen } = useControlledDropdownMenu();

  /** Most users will have an invite, however we have to handle SSO case:
   *
   * 1. If the user has an invite, we show the "Resend invite" and "Cancel invite" buttons.
   * 2. If the user has accepted the invite or doesn't have an invite but has userId(SSO), we show the "Revoke access" button.
   */
  const hasInvite = !!inviteStatus;

  return hasInvite || (!hasInvite && isSSO) ? (
    <>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => setOpen(open)}
        open={open}
      >
        <DropdownMenuTrigger className="w-full " asChild>
          {customTrigger ? (
            customTrigger(disabled)
          ) : (
            <Button
              variant="tertiary"
              width="full"
              className="border-0 pr-0"
              aria-label="Actions Trigger"
            >
              {disabled ? <Spinner className="size-4" /> : <VerticalDotsIcon />}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="order w-[180px] rounded-md bg-white p-[6px] text-right"
          asChild
          ref={ref}
        >
          <fetcher.Form
            method="post"
            onSubmit={() => {
              setOpen(false);
            }}
          >
            {/* Only show resend button if the invite is not accepted */}
            {inviteStatus && inviteStatus !== "ACCEPTED" ? (
              <>
                <input type="hidden" name="name" value={name} />
                <input type="hidden" name="email" value={email} />
                <input type="hidden" name="teamMemberId" value={teamMemberId} />
                <input type="hidden" name="userFriendlyRole" value={role} />
                <Button
                  type="submit"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:bg-slate-100 hover:text-gray-700 focus:bg-slate-100"
                  width="full"
                  name="intent"
                  value="resend"
                  disabled={disabled}
                >
                  <span className="flex items-center gap-2">
                    <RefreshIcon /> Resend invite
                  </span>
                </Button>
                <Button
                  type="submit"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:bg-slate-100 hover:text-gray-700 focus:bg-slate-100"
                  width="full"
                  name="intent"
                  value="cancelInvite"
                  disabled={disabled}
                >
                  <span className="flex items-center gap-2">
                    <UserXIcon /> Cancel invite
                  </span>
                </Button>
              </>
            ) : null}
            {(hasInvite && inviteStatus === "ACCEPTED") ||
            (!hasInvite && isSSO) ? (
              <>
                {userId ? (
                  <input type="hidden" name="userId" value={userId} />
                ) : null}
                <Button
                  type="submit"
                  variant="link"
                  className="justify-start px-4 py-3  text-gray-700 hover:bg-slate-100 hover:text-gray-700 focus:bg-slate-100"
                  width="full"
                  name="intent"
                  value="revokeAccess"
                  disabled={disabled}
                >
                  <span className="flex items-center gap-2">
                    <RemoveUserIcon /> Revoke access
                  </span>
                </Button>
              </>
            ) : null}
          </fetcher.Form>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  ) : null;
}
