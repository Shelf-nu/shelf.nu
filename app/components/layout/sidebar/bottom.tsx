import { useState } from "react";
import type { User } from "@prisma/client";
import { Form } from "@remix-run/react";
import { ChevronRight, QuestionsIcon } from "~/components/icons";
import { CrispButton } from "~/components/marketing/crisp";
import { Button } from "~/components/shared";
import {
  DropdownMenuItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import ProfilePicture from "~/components/user/profile-picture";
import { tw } from "~/utils";

interface Props {
  user: Pick<User, "username" | "email">;
  isSidebarMinimized: boolean;
}

export default function SidebarBottom({ user, isSidebarMinimized }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <div className="bottom gap-2">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="outline-none focus-visible:border-0"
        >
          <div
            className={`flex items-center justify-between gap-x-5 rounded-lg border-[1px] border-gray-200 p-2 hover:bg-gray-100 ${
              isSidebarMinimized && "w-[57px]"
            }`}
          >
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
                dropdownOpen ? "-rotate-90" : "rotate-90"
              }`}
            >
              <ChevronRight />
            </i>
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="order ml-[16px] w-[260px] rounded-md bg-white p-0 text-right"
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
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className="border-b-[1px] border-gray-200 px-4 py-3"
          >
            <CrispButton
              className={tw("justify-start text-gray-700 hover:text-gray-700")}
              variant="link"
              width="full"
              title="Questions/Feedback"
            >
              <span className="flex items-center justify-start gap-3">
                <i className="icon text-gray-500">
                  <QuestionsIcon />
                </i>
                <span className="text whitespace-nowrap transition duration-200 ease-linear">
                  Questions/Feedback
                </span>
              </span>
            </CrispButton>
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
