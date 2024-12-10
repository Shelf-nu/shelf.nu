import { useState } from "react";
import type { User } from "@prisma/client";
import { useAtom } from "jotai";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";
import { Form } from "~/components/custom-form";
import { ChevronRight, QuestionsIcon } from "~/components/icons/library";
import { CrispButton } from "~/components/marketing/crisp";
import { Button } from "~/components/shared/button";
import {
  DropdownMenuItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import ProfilePicture from "~/components/user/profile-picture";
import { tw } from "~/utils/tw";

interface Props {
  user: Pick<User, "username" | "email">;
}

export default function SidebarBottom({ user }: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [workspaceSwitching] = useAtom(switchingWorkspaceAtom);

  return (
    <div
      className={tw(
        "bottom gap-2",
        workspaceSwitching ? "pointer-events-none" : ""
      )}
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="w-full truncate outline-none focus-visible:border-0"
        >
          <div
            className={tw(
              `flex w-full items-center justify-between rounded border border-gray-200  px-2 py-1 hover:bg-gray-100`
            )}
          >
            <ProfilePicture
              width="w-8"
              height="h-8"
              className="mr-3 shrink-0"
            />
            <div className="user-credentials grow truncate text-left text-[14px] transition-all duration-200 ease-linear">
              <div className="line-clamp-1 block text-ellipsis font-semibold">
                {user.username}
              </div>
              <div
                className="line-clamp-1 block max-w-full text-ellipsis"
                data-test-id="userEmail"
              >
                {user.email}
              </div>
            </div>
            <div className="shrink-0">
              <i
                className={`inline-block px-3 py-0 text-gray-400 transition-all duration-300 ease-out ${
                  dropdownOpen ? "-rotate-90" : "rotate-90"
                }`}
              >
                <ChevronRight />
              </i>
            </div>
          </div>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="end"
          className="order ml-[16px] w-[280px] rounded bg-white p-0 text-right"
        >
          <DropdownMenuItem className="border-b border-gray-200 p-0">
            <Button
              to="/me"
              icon="profile"
              role="link"
              variant="link"
              className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
              width="full"
            >
              My Profile
            </Button>
          </DropdownMenuItem>
          <DropdownMenuItem className="border-b border-gray-200 p-0">
            <Button
              to="/account-details"
              icon="profile"
              role="link"
              variant="link"
              className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
              width="full"
            >
              Account Details
            </Button>
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            className="border-b border-gray-200 p-0"
          >
            <CrispButton
              className={tw(
                "justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
              )}
              variant="link"
              width="full"
              title="Questions/Feedback"
            >
              <span className="flex items-center justify-start gap-2">
                <i className="icon text-gray-700">
                  <QuestionsIcon />
                </i>
                <span className="text whitespace-nowrap transition duration-200 ease-linear">
                  Questions/Feedback
                </span>
              </span>
            </CrispButton>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="p-0"
            onSelect={(e) => e.preventDefault()}
          >
            <Form action="/logout" method="post" className="w-full">
              <Button
                icon="logout"
                role="link"
                type="submit"
                variant="link"
                className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
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
