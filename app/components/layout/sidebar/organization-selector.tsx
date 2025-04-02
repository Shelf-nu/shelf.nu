import { useEffect, useState } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useSetAtom } from "jotai";
import invariant from "tiny-invariant";
import { switchingWorkspaceAtom } from "~/atoms/switching-workspace";
import { Button } from "~/components/shared/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/shared/dropdown";
import { Image } from "~/components/shared/image";
import ProfilePicture from "~/components/user/profile-picture";
import When from "~/components/when/when";
import type { loader } from "~/routes/_layout+/_layout";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./sidebar";

export default function OrganizationSelector() {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const { open, openMobile, isMobile } = useSidebar();

  const { organizations, currentOrganizationId } =
    useLoaderData<typeof loader>();

  const fetcher = useFetcher();
  const isSwitchingOrg = isFormProcessing(fetcher.state);

  const setWorkspaceSwitching = useSetAtom(switchingWorkspaceAtom);

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

  function closeDropdown() {
    setIsDropdownOpen(false);
  }

  useEffect(
    function setSwitchingWorkspaceAfterFetch() {
      setWorkspaceSwitching(isSwitchingOrg);
    },
    [isSwitchingOrg, setWorkspaceSwitching]
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem className={tw(openMobile && "px-2")}>
        <DropdownMenu open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
          <DropdownMenuTrigger disabled={isSwitchingOrg} asChild>
            <SidebarMenuButton
              className={tw(
                "size-full truncate !p-1 data-[state=open]:bg-gray-50 data-[state=open]:text-sidebar-accent-foreground hover:bg-gray-50",
                open || openMobile ? "border" : ""
              )}
            >
              {currentOrganization.type === "PERSONAL" ? (
                <ProfilePicture width="w-6" height="h-6" />
              ) : (
                <Image
                  imageId={currentOrganization.imageId}
                  alt="img"
                  className="size-8 rounded-sm border object-cover"
                  updatedAt={currentOrganization.updatedAt}
                />
              )}

              <When truthy={open || openMobile}>
                <>
                  <div
                    className="max-w-[calc(100%-36px)] flex-1 text-left text-sm leading-tight"
                    title={currentOrganization.name}
                  >
                    <span className="block max-w-full truncate font-semibold">
                      {currentOrganization.name}
                    </span>
                  </div>
                  <ChevronDownIcon className="ml-auto" />
                </>
              </When>
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            className="!mt-0 max-h-96 w-[--radix-dropdown-menu-trigger-width] min-w-56 overflow-auto rounded p-1 scrollbar-thin"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
            onWheel={(event) => {
              event.stopPropagation();
            }}
            onTouchMove={(event) => {
              event.stopPropagation();
            }}
          >
            {organizations.map((organization) => (
              <DropdownMenuItem
                key={organization.id}
                className={tw(
                  "gap-2 rounded-sm p-2",
                  currentOrganization.id === organization.id &&
                    "bg-gray-50 text-sidebar-accent-foreground"
                )}
                onClick={() => {
                  if (organization.id !== currentOrganizationId) {
                    handleSwitchOrganization(organization.id);
                  }
                }}
              >
                {organization.type === "PERSONAL" ? (
                  <ProfilePicture width="w-6" height="h-6" />
                ) : (
                  <Image
                    imageId={organization.imageId}
                    alt="img"
                    className="size-6 rounded-sm border object-cover"
                    updatedAt={organization.updatedAt}
                  />
                )}
                {organization.name}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <Button
              to="/account-details/workspace"
              icon="settings"
              variant="link"
              className=" w-full select-none justify-start rounded p-2 text-left font-medium text-gray-900 outline-none  hover:bg-gray-50 hover:text-gray-800 "
              onClick={closeDropdown}
            >
              Manage workspaces
            </Button>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
