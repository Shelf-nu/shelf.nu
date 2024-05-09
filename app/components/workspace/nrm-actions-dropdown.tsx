import { useMemo } from "react";
import type { Prisma } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { SendIcon, VerticalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import type { loader } from "~/routes/_layout+/settings.team";
import { isPersonalOrg as checkIsPersonalOrg } from "~/utils/organization";
import { useControlledDropdownMenu } from "~/utils/use-controlled-dropdown-menu";
import { DeleteMember } from "./delete-member";
import { ControlledActionButton } from "../shared/controlled-action-button";

export function TeamMembersActionsDropdown({
  teamMember,
}: {
  teamMember: Prisma.TeamMemberGetPayload<{
    include: {
      _count: {
        select: {
          custodies: true;
        };
      };
    };
  }>;
}) {
  const { organization } = useLoaderData<typeof loader>();
  const [ref, open, setOpen] = useControlledDropdownMenu(false);
  const isPersonalOrg = useMemo(
    () => checkIsPersonalOrg(organization),
    [organization]
  );

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
        ref={ref}
      >
        <DropdownMenuItem className="p-4 text-gray-700 hover:bg-slate-100 hover:text-gray-800">
          <ControlledActionButton
            canUseFeature={!isPersonalOrg}
            buttonContent={{
              title: (
                <span className="flex items-center gap-2 text-gray-700">
                  <SendIcon /> Invite user
                </span>
              ),
              message:
                "You are not able to invite users to a personal workspace. ",
            }}
            buttonProps={{
              to: `invite-user?teamMemberId=${teamMember.id}`,
              role: "link",
              variant: "link",
              className: "justify-start  !text-gray-700 !hover:text-gray-700",
              width: "full",
              onClick: () => setOpen(false),
            }}
          />
        </DropdownMenuItem>

        <DeleteMember teamMember={teamMember} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
