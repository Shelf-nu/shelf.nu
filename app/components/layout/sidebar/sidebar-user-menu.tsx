import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./sidebar";
import { useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";
import ProfilePicture from "~/components/user/profile-picture";
import { ChevronRight, QuestionsIcon } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { CrispButton } from "~/components/marketing/crisp";
import { Form } from "~/components/custom-form";

export default function SidebarUserMenu() {
  const { user } = useLoaderData<typeof loader>();
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <ProfilePicture
                width="w-8"
                height="h-8"
                className="mr-3 shrink-0"
              />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{user.username}</span>
                <span className="truncate text-xs">{user.email}</span>
              </div>
              <ChevronRight className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <ProfilePicture
                  width="w-8"
                  height="h-8"
                  className="mr-3 shrink-0"
                />
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {user.username}
                  </span>
                  <span className="truncate text-xs">{user.email}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
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
                className="justify-start px-4 py-3 text-gray-700 hover:text-gray-700"
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
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
