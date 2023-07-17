import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "../forms";
import { UserIcon } from "../icons";

const teamMembers = [
  {
    id: 1,
    name: "Phoenix Baker",
  },
  {
    id: 2,
    name: "Carlos Virreira",
  },
  {
    id: 3,
    name: "Lana Steiner",
  },
  {
    id: 4,
    name: "Demi Wilkinson",
  },
  {
    id: 5,
    name: "Candice Wu",
  },
  {
    id: 6,
    name: "Natali Craig",
  },
  {
    id: 7,
    name: "Drew Cano",
  },
  {
    id: 8,
    name: "Nikolay Bonev",
  },
];
export default function CustodianSelect() {
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
                  <SelectItem key={member.id} value={member.name}>
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
              <div>No team members found. Please add team members</div>
            )}
          </SelectContent>
        </div>
      </Select>
    </div>
  );
}
