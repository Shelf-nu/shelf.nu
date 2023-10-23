import type { InviteStatuses, User } from "@prisma/client";
import {
  RefreshIcon,
  RemoveUserIcon,
  VerticalDotsIcon,
} from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import type { WithDateFields } from "~/modules/types";
import { Button } from "../shared";

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
        className="order w-[180px] rounded-md bg-white p-[6px] text-right"
      >
        {/* Only show resend button if the invite is not accepted */}
        {inviteStatus !== "ACCEPTED" ? (
          <DropdownMenuItem className="mb-2.5 p-4 md:mb-0 md:p-0">
            <Button
              to="update-location"
              role="link"
              variant="link"
              className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
              width="full"
            >
              <span className="flex items-center gap-2">
                <RefreshIcon /> Resend invite
              </span>
            </Button>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="mb-2.5 p-4 md:mb-0 md:p-0">
          <Button
            role="link"
            variant="link"
            className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
            width="full"
          >
            <span className="flex items-center gap-2">
              <RemoveUserIcon /> Revoke access
            </span>
          </Button>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
