import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/assets.$assetId.give-custody";
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
  return (
    <div className="relative w-full">
      <Select name="custodian">
        <SelectTrigger>
          <SelectValue placeholder="Select a team member" />
        </SelectTrigger>
        <div>
          <SelectContent
            className="w-[352px]"
            position="popper"
            align="start"
            // This piece of code was present to prevent an error where selecting an item
            // will click through the item and click the element in the back
            // However this causes another error, namely that you are not able to scroll the entries inside the select
            // if there are too many entries.
            // After the new issue came up, we did some testing and couldnt anymore recreate the original issue
            // so for now I am comming out this code.
            // Original issue when this was added: https://github.com/Shelf-nu/shelf.nu/issues/415
            // New issue with scrolling problem: https://github.com/Shelf-nu/shelf.nu/issues/553
            // ref={(ref) => {
            //   if (!ref) return;
            //   ref.ontouchstart = (e) => e.preventDefault();
            // }}
          >
            {teamMembers.length > 0 ? (
              <div className=" max-h-[320px] overflow-auto">
                {teamMembers.map((member) => (
                  <SelectItem
                    key={member.id}
                    value={JSON.stringify({ id: member.id, name: member.name })}
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
