import { VerticalDotsIcon } from "~/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import type { TeamMemberWithCustodies } from "~/routes/_layout+/settings.workspace.$orgId";
import { DeleteMember } from "./delete-member";

export function ActionsDropdown({
  teamMember,
}: {
  teamMember: TeamMemberWithCustodies;
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
        <DeleteMember teamMember={teamMember} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
