import { useState } from "react";
import type { Prisma } from "@prisma/client";
import { useLoaderData } from "@remix-run/react";
import { VerticalDotsIcon } from "~/components/icons/library";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";

import { useControlledDropdownMenu } from "~/hooks/use-controlled-dropdown-menu";
import type { loader } from "~/routes/_layout+/settings.team.nrm";
import { DeleteMember } from "./delete-member";
import InviteUserDialog from "../settings/invite-user-dialog";
import { Button } from "../shared/button";

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
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const { isPersonalOrg } = useLoaderData<typeof loader>();
  const { ref, open, setOpen } = useControlledDropdownMenu();

  return (
    <>
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => setOpen(open)}
        open={open}
      >
        <DropdownMenuTrigger
          className="outline-none focus-visible:border-0"
          aria-label="Actions Trigger"
        >
          <i className="inline-block px-3 py-0 text-gray-400 ">
            <VerticalDotsIcon />
          </i>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="order w-[180px] rounded-md bg-white p-[6px] text-right "
          ref={ref}
        >
          <DropdownMenuItem
            className="p-0 text-gray-700 hover:bg-slate-100 hover:text-gray-700"
            onSelect={(e) => e.preventDefault()}
          >
            <Button
              icon="send"
              variant="link"
              className="!hover:text-gray-700 justify-start p-4 !text-gray-700"
              onClick={() => {
                setIsInviteOpen(true);
                setOpen(false);
              }}
              disabled={
                isPersonalOrg
                  ? {
                      reason:
                        "You are not able to invite users to a personal workspace. ",
                    }
                  : false
              }
            >
              Invite user
            </Button>
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

      <InviteUserDialog
        teamMemberId={teamMember.id}
        open={isInviteOpen}
        onClose={() => {
          setIsInviteOpen(false);
        }}
      />
    </>
  );
}
