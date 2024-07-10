import type { Prisma } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { SendIcon, VerticalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import type { loader } from "~/routes/_layout+/settings.team.nrm";
import { tw } from "~/utils/tw";
import { useControlledDropdownMenu } from "~/utils/use-controlled-dropdown-menu";
import { DeleteMember } from "./delete-member";
import { Button } from "../shared/button";
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
  const { isPersonalOrg } = useLoaderData<typeof loader>();
  const { ref, open, setOpen } = useControlledDropdownMenu();

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
        <DropdownMenuItem className="p-0 text-gray-700 hover:bg-slate-100 hover:text-gray-700">
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
              to: `/settings/team/users/invite-user?teamMemberId=${teamMember.id}`,
              role: "link",
              variant: "link",
              className: tw(
                "!hover:text-gray-700 justify-start  p-4 !text-gray-700"
              ),
              width: "full",
              disabled: isPersonalOrg,
              onClick: () => setOpen(false),
            }}
          />
        </DropdownMenuItem>

        <DropdownMenuItem className="p-0 text-gray-700 hover:bg-slate-100 hover:text-gray-700">
          <Button
            to={`${teamMember.id}/edit`}
            role="link"
            variant="link"
            className="justify-start whitespace-nowrap px-4 py-3  text-gray-700 hover:text-gray-700"
            width="full"
            icon="pen"
            onClick={() => setOpen(false)}
          >
            Edit
          </Button>
        </DropdownMenuItem>

        <DeleteMember teamMember={teamMember} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
