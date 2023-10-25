import { useState } from "react";
import { SendIcon, VerticalDotsIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import type { WithDateFields } from "~/modules/types";
import type { TeamMemberWithCustodies } from "~/routes/_layout+/settings.team";
import { DeleteMember } from "./delete-member";
import { Button } from "../shared";

export function TeamMembersActionsDropdown({
  teamMember,
}: {
  teamMember: WithDateFields<TeamMemberWithCustodies, string>;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => setOpen(open)}
      open={open}
    >
      <DropdownMenuTrigger className="outline-none focus-visible:border-0">
        <i className="inline-block px-3 py-0 text-gray-400 ">
          <VerticalDotsIcon />
        </i>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="order w-[180px] rounded-md bg-white p-[6px] text-right "
      >
        <DropdownMenuItem className="mb-2.5 p-4 md:mb-0 md:p-0">
          <Button
            to={`invite-user?teamMemberId=${teamMember.id}`}
            role="link"
            variant="link"
            className="justify-start px-4 py-3  text-gray-700 hover:text-gray-700"
            width="full"
            onClick={() => setOpen(false)}
          >
            <span className="flex items-center gap-2">
              <SendIcon /> Invite user
            </span>
          </Button>
        </DropdownMenuItem>
        <DeleteMember teamMember={teamMember} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
