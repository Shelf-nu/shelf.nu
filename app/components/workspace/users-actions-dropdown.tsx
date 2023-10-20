import type { InviteStatuses, User } from "@prisma/client";
import { VerticalDotsIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import type { WithDateFields } from "~/modules/types";

export function TeamUsersActionsDropdown({
  user,
  inviteStatus,
}: {
  user?: WithDateFields<User, string>;
  inviteStatus: InviteStatuses;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger className="outline-none focus-visible:border-0">
        <i className="inline-block px-3 py-0 text-gray-400 ">
          <VerticalDotsIcon />
        </i>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-white p-0 text-right "
      >
        {/* Only show resend button if the invite is not accepted */}
        {inviteStatus !== "ACCEPTED" ? (
          <DropdownMenuItem>Resend invite</DropdownMenuItem>
        ) : null}
        <DropdownMenuItem>Revoke access</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
