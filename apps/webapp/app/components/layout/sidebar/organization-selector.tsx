import { useState } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { useFetcher, useLoaderData } from "react-router";
import invariant from "tiny-invariant";
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
import { CHANGE_CURRENT_ORGANIZATION_ACTION } from "~/modules/organization/constants";
import type { loader } from "~/routes/_layout+/_layout";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "./sidebar";

/**
 * Plan marker shown beside a Personal workspace name.
 *
 * Personal workspaces cannot invite anyone regardless of plan, so the marker
 * states the plan the user actually pays for rather than assuming "free" from
 * the workspace type. Team-tier users get no marker: they already pay for Team,
 * and badging their Personal workspace would misrepresent what it is.
 *
 * @param tierId - The user's subscription tier
 * @returns The label to render, or null when no marker should be shown
 */
function getPersonalPlanLabel(tierId: string | null | undefined) {
  if (tierId === "free") return "Free";
  if (tierId === "tier_1") return "Plus";
  return null;
}

export default function OrganizationSelector() {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const { open, openMobile, isMobile } = useSidebar();

  const { organizations, currentOrganizationId, user } =
    useLoaderData<typeof loader>();

  /** Plan marker for a Personal workspace; null when none should show. */
  const personalPlanLabel = getPersonalPlanLabel(user?.tierId);

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

    void fetcher.submit(formData, {
      method: "POST",
      action: CHANGE_CURRENT_ORGANIZATION_ACTION,
    });
  }

  function closeDropdown() {
    setIsDropdownOpen(false);
  }

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
                  {currentOrganization.type === "PERSONAL" &&
                  personalPlanLabel ? (
                    <span className="ml-1 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                      {personalPlanLabel}
                    </span>
                  ) : null}
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
            {currentOrganization.type === "PERSONAL" ? (
              <Button
                to="/settings/team"
                variant="link"
                className="w-full select-none justify-start rounded p-2 text-left font-medium text-primary-700 outline-none hover:bg-gray-50"
                onClick={closeDropdown}
              >
                Upgrade to invite your team
              </Button>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
