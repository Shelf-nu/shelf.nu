import type { Prisma } from "@prisma/client";
import { Link } from "@remix-run/react";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../shared/tooltip";
import When from "../when/when";

type ReminderTeamMembersProps = {
  className?: string;
  style?: React.CSSProperties;
  teamMembers: Prisma.TeamMemberGetPayload<{
    select: {
      id: true;
      name: true;
      user: {
        select: {
          id: true;
          firstName: true;
          lastName: true;
          profilePicture: true;
        };
      };
    };
  }>[];
  imgClassName?: string;
  extraContent?: React.ReactNode;
  isAlreadySent?: boolean;
};

export default function ReminderTeamMembers({
  className,
  style,
  teamMembers,
  imgClassName,
  extraContent,
  isAlreadySent = false,
}: ReminderTeamMembersProps) {
  return (
    <div className={tw("flex items-center", className)} style={style}>
      {teamMembers.map((teamMember) => {
        const isAccessRevoed = !teamMember.user;

        return (
          <TooltipProvider key={teamMember.id}>
            <Tooltip>
              <TooltipTrigger>
                <Link
                  to={`/settings/team/users/${teamMember?.user?.id}/assets`}
                  className={tw(
                    "-ml-1 flex size-6 shrink-0 items-center justify-center overflow-hidden rounded border border-white",
                    imgClassName,
                    isAccessRevoed && "border-error-500"
                  )}
                >
                  <img
                    alt={teamMember.name}
                    className="size-full object-cover"
                    src={
                      teamMember?.user?.profilePicture ??
                      "/static/images/default_pfp.jpg"
                    }
                  />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-72">
                <p>{resolveTeamMemberName(teamMember, true)}</p>

                <When truthy={isAccessRevoed && !isAlreadySent}>
                  <p className="mt-2 text-error-500">
                    This team member has been removed from the workspace. As a
                    fallback the reminder email will be sent to the workspace
                    Owner. You can always edit the reminder to assign it to a
                    different user.
                  </p>
                </When>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })}

      {extraContent}
    </div>
  );
}
