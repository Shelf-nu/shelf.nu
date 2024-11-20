import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./sidebar";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { useIsMobile } from "~/hooks/use-mobile";
import { useFetcher, useLoaderData } from "@remix-run/react";
import type { loader } from "~/routes/_layout+/_layout";
import ProfilePicture from "~/components/user/profile-picture";
import { Image } from "~/components/shared/image";
import { Button } from "~/components/shared/button";
import invariant from "tiny-invariant";
import { isFormProcessing } from "~/utils/form";

export default function OrganizationSelector() {
  const isMobile = useIsMobile();
  const { organizations, currentOrganizationId } =
    useLoaderData<typeof loader>();

  const fetcher = useFetcher();
  const isSwitchingOrg = isFormProcessing(fetcher.state);

  const currentOrganization = organizations.find(
    (org) => org.id === currentOrganizationId
  );
  invariant(
    typeof currentOrganization !== "undefined",
    "Something went wrong. Current organization is not in the list of organizations."
  );

  function handleSwitchOrganization(organizationId: string) {
    const formData = new FormData();
    formData.append("organizationId", organizationId);

    fetcher.submit(formData, {
      method: "POST",
      action: "/api/user/change-current-organization",
    });
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={isSwitchingOrg} asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {currentOrganization.type === "PERSONAL" ? (
                <ProfilePicture width="w-6" height="h-6" />
              ) : (
                <Image
                  imageId={currentOrganization.imageId}
                  alt="img"
                  className="size-6 rounded-[2px] object-cover"
                  updatedAt={currentOrganization.updatedAt}
                />
              )}
              <div className="flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">
                  {currentOrganization.name}
                </span>
              </div>
              <ChevronDownIcon className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            {organizations.map((organization, index) => (
              <DropdownMenuItem
                key={organization.id}
                className="gap-2 p-2"
                onClick={() => {
                  if (organization.id !== currentOrganizationId) {
                    handleSwitchOrganization(organization.id);
                  }
                }}
              >
                {organization.name}
                <DropdownMenuShortcut>⌘{index + 1}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <Button
              to="/account-details/workspace"
              icon="settings"
              variant="link"
              className=" w-full select-none justify-start rounded p-2 text-left font-medium text-gray-900 outline-none  hover:bg-gray-50 hover:text-gray-800 "
            >
              Manage workspaces
            </Button>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
