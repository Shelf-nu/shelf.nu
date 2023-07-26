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
          <SelectContent className="w-[352px]" position="popper" align="start">
            {teamMembers.length > 0 ? (
              <div className=" max-h-[320px] overflow-auto">
                {teamMembers.map((member) => (
                  <SelectItem
                    key={member.id}
                    value={JSON.stringify({ id: member.id, name: member.name })}
                  >
                    <div className="flex items-center gap-3 py-3.5">
                      <i>
                        <UserIcon />
                      </i>
                      <span className=" flex-1 font-medium text-gray-900">
                        {member.name}
                      </span>
                    </div>
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
