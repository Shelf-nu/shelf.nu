import { useLoaderData } from "@remix-run/react";
import { useAtom } from "jotai";
import type { loader } from "~/routes/_layout+/assets.$assetId.give-custody";
import { updateSelectedCustodyUserAtom } from "../../atoms/assign-custody-user";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../forms";
import { UserIcon } from "../icons";
import { Button } from "../shared";

export default function CustodianSelect() {
  const { teamMembers } = useLoaderData<typeof loader>();
  const [, updateSelectedCustodyUser] = useAtom(updateSelectedCustodyUserAtom);

  return (
    <div className="relative w-full">
      <Select
        onValueChange={(e) => updateSelectedCustodyUser(JSON.parse(e))}
        name="custodian"
      >
        <SelectTrigger>
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
                    value={JSON.stringify({
                      id: member.id,
                      name: member.name,
                      userId: member.userId,
                    })}
                  >
                    {member.user ? (
                      <div className="flex items-center gap-3 py-3.5">
                        <img
                          src={
                            member.user.profilePicture ||
                            "/images/default_pfp.jpg"
                          }
                          className={"w-[20px] rounded-[4px]"}
                          alt={`${member.user.firstName} ${member.user.lastName}'s profile`}
                        />
                        <span className=" flex-1 font-medium text-gray-900">
                          {member.user.firstName} {member.user.lastName}
                        </span>
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
