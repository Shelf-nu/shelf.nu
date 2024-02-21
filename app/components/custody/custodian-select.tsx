import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets.$assetId.give-custody";
import { tw } from "~/utils";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../forms";
import { UserIcon } from "../icons";
import { Button } from "../shared";

export default function CustodianSelect(
  {
    defaultCustodianId,
    defaultTeamMemberId,
    disabled,
    showEmail,
    className,
  }: {
    defaultCustodianId?: string;
    defaultTeamMemberId?: string;
    disabled?: boolean;
    showEmail?: boolean;
    className?: string;
  } = {
    defaultCustodianId: "",
    disabled: false,
    showEmail: false,
    className: "",
  }
) {
  const { teamMembers } = useLoaderData<typeof loader>();

  let defaultValue = undefined;

  if (defaultCustodianId) {
    // In the case of custodian id passed, we set that to id and find the rest in the teamMembers array
    defaultValue = JSON.stringify({
      id: defaultCustodianId,
      name: teamMembers.find((member) => member.id === defaultCustodianId)
        ?.name,
      userId: teamMembers.find((member) => member.id === defaultCustodianId)
        ?.userId,
    });
  } else if (defaultTeamMemberId) {
    // In the case of team member id passed, we set that to id and find the rest in the teamMembers array
    defaultValue = JSON.stringify({
      id: teamMembers.find((member) => member.userId === defaultTeamMemberId)
        ?.id,
      name: teamMembers.find((member) => member.userId === defaultTeamMemberId)
        ?.name,
      userId: defaultTeamMemberId,
    });
  }

  return (
    <div className="relative w-full">
      <Select name="custodian" defaultValue={defaultValue} disabled={disabled}>
        <SelectTrigger
          className={tw(
            disabled ? "cursor-not-allowed" : "",
            "custodian-selector",
            "text-left",
            className
          )}
        >
          <SelectValue placeholder="Select a team member" />
        </SelectTrigger>
        <div>
          <SelectContent
            className="w-[352px]"
            position="popper"
            align="start"
            ref={(ref) =>
              ref?.addEventListener("touchend", (e) => e.preventDefault())
            }
          >
            {teamMembers.length > 0 ? (
              <div className=" max-h-[320px] overflow-auto">
                {teamMembers.map((member) => (
                  <SelectItem
                    key={member.id}
                    value={`${JSON.stringify({
                      id: member.id,
                      name: member.name,
                      userId: member?.userId,
                    })}`}
                  >
                    {member.user ? (
                      <div className="flex items-center gap-3 truncate py-3.5 pr-1">
                        <img
                          src={
                            member.user.profilePicture ||
                            "/static/images/default_pfp.jpg"
                          }
                          className={"w-[20px] rounded-[4px]"}
                          alt={`${member.user.firstName} ${member.user.lastName}'s profile`}
                        />
                        <span className=" whitespace-nowrap text-left font-medium text-gray-900">
                          {member.user.firstName} {member.user.lastName}
                        </span>
                        {showEmail ? (
                          <span className="truncate text-xs text-gray-500">
                            {member.user.email}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 py-3.5">
                        <i>
                          <UserIcon />
                        </i>
                        <span className=" flex-1 font-medium text-gray-900">
                          {member.name}
                        </span>
                      </div>
                    )}
                  </SelectItem>
                ))}
              </div>
            ) : (
              <div>
                No team members found.{" "}
                <Button to={"/settings/workspace"} variant="link">
                  Create team members
                </Button>
              </div>
            )}
          </SelectContent>
        </div>
      </Select>
    </div>
  );
}
