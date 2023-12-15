import { useState } from "react";
import type { User } from "@prisma/client";
import { Form } from "@remix-run/react";
import { ChevronDown } from "~/components/icons";
import { Button } from "~/components/shared";
import {
  DropdownMenuItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import ProfilePicture from "~/components/user/profile-picture";
import {} from "@radix-ui/react-dropdown-menu";

interface Props {
  user: Pick<User, "username" | "email">;
}

export default function SidebarBottom({ user }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="bottom w-full gap-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="outline-none focus-visible:border-0"
        >
          <div className="flex w-full items-center justify-between gap-x-5 rounded-lg border-[1px] border-gray-200 p-3 hover:bg-gray-100">
            <div className="flex gap-3">
              <ProfilePicture width="w-10" height="h-10" />
              <div className="user-credentials flex-1 text-left text-[14px] transition-all duration-200 ease-linear">
                <div className="line-clamp-1 block text-ellipsis font-semibold">
                  {user.username}
                </div>
                <p
                  className="line-clamp-1 block text-ellipsis"
                  data-test-id="userEmail"
                >
                  {user.email}
                </p>
              </div>
            </div>

            <i
              className={`inline-block px-3 py-0 text-gray-400 transition-all duration-300 ease-out ${
                dropdownOpen && "rotate-180"
              }`}
            >
              <ChevronDown />
            </i>
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="order w-[280px] rounded-md bg-white p-0 text-right "
        >
          <DropdownMenuItem className="border-b-[1px] border-gray-200 px-4 py-3">
            <Button
              to={`settings/account`}
              icon="profile"
              role="link"
              variant="link"
              className="justify-start text-gray-700 hover:text-gray-700"
              width="full"
            >
              Account Details
            </Button>
          </DropdownMenuItem>
          <DropdownMenuItem className="px-4 py-3">
            <Button
              icon="question"
              role="link"
              variant="link"
              className="justify-start text-gray-700 hover:text-gray-700"
              width="full"
            >
              Leave Feedback
            </Button>
          </DropdownMenuItem>
          <DropdownMenuItem className="border-b-[1px] border-gray-200 px-4 py-3">
            <Button
              icon="help"
              role="link"
              variant="link"
              className="justify-start text-gray-700 hover:text-gray-700"
              width="full"
            >
              Contact Support
            </Button>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="px-4 py-3"
            onSelect={(e) => e.preventDefault()}
          >
            <Form action="/logout" method="post">
              <Button
                icon="logout"
                role="link"
                type="submit"
                variant="link"
                className="justify-start text-gray-700 hover:text-gray-700"
                width="full"
              >
                Log Out
              </Button>
            </Form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
