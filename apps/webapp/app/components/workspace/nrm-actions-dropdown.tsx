import { useState } from "react";
import type { Prisma } from "@prisma/client";
import { useLoaderData } from "react-router";
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

/**
 * Row actions for a non-registered member: invite, edit and delete.
 *
 * Edit and delete show with the caller's `nonRegisteredMember` grants; the
 * routes behind them keep their own gates. With neither grant the menu is not
 * rendered.
 *
 * @param props.teamMember - The member the actions apply to
 * @param props.canEdit - Whether the caller holds `nonRegisteredMember:update`
 * @param props.canDelete - Whether the caller holds `nonRegisteredMember:delete`
 */
export function TeamMembersActionsDropdown({
  teamMember,
  canEdit,
  canDelete,
}: {
  /** Whether the caller holds `nonRegisteredMember:update`: shows Edit. */
  canEdit: boolean;
  /** Whether the caller holds `nonRegisteredMember:delete`: shows Delete. */
  canDelete: boolean;
  teamMember: Prisma.TeamMemberGetPayload<{
    include: {
      _count: {
        select: {
          custodies: true;
          kitCustodies: true;
        };
      };
    };
  }>;
}) {
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const { isPersonalOrg } = useLoaderData<typeof loader>();
  const { ref, open, setOpen } = useControlledDropdownMenu();

  if (!canEdit && !canDelete) {
    return null;
  }

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
              type="button"
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

          {canEdit ? (
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
          ) : null}

          {canDelete ? <DeleteMember teamMember={teamMember} /> : null}
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
