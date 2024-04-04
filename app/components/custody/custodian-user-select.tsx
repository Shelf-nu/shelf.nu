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

/** Custodian select that works only for with users and doesnt support team members
 * This is used for something like bookings where the custodian can only be a team member
 */
export default function CustodianUserSelect(
  {
    defaultUserId,
    disabled,
    showEmail,
    className,
  }: {
    defaultUserId?: string;
    disabled?: boolean;
    showEmail?: boolean;
    className?: string;
  } = {
    disabled: false,
    showEmail: false,
    className: "",
  }
) {
  const { teamMembers } = useLoaderData<typeof loader>();

  // In the case of team member id passed, we set that to id and find the rest in the teamMembers array
  let defaultValue = defaultUserId
    ? JSON.stringify({
        id: teamMembers.find((member) => member.userId === defaultUserId)?.id,
        name: teamMembers.find((member) => member.userId === defaultUserId)
          ?.name,
        userId: defaultUserId,
      })
    : undefined;
  return (
    <div className="relative w-full">
      <Select name="custodian" defaultValue={defaultValue} disabled={disabled}>
        <SelectTrigger
          className={tw(
            disabled ? "cursor-not-allowed" : "",
            "custodian-selector min-h-[38px] text-left",
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
                    className="py-3"
                  >
                    {member.user ? (
                      <div className="flex items-center gap-3 truncate pr-1">
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
                      <div className="flex items-center gap-3">
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
