import { ChevronRight, HomeIcon } from "~/components/icons/library";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "./sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "~/components/shared/collapsible";
import { cloneElement } from "react";
import { NavLink } from "@remix-run/react";
import { tw } from "~/utils/tw";

type NavItem = {
  title: string;
  url: string;
  icon: React.ReactElement;
  items: Array<{ title: string; url: string }>;
};

const NAV_ITEMS: NavItem[] = [
  {
    title: "Nav items",
    url: "/",
    icon: <HomeIcon />,
    items: [
      {
        title: "Home",
        url: "/",
      },
      {
        title: "Home",
        url: "/",
      },
      {
        title: "Home",
        url: "/",
      },
      {
        title: "Home",
        url: "/",
      },
    ],
  },
];

export default function SidebarNav() {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>Platform</SidebarGroupLabel>
      <SidebarMenu>
        {NAV_ITEMS.map((item) => (
          <Collapsible key={item.title} asChild className="group/collapsible">
            <SidebarMenuItem>
              <CollapsibleTrigger asChild>
                <SidebarMenuButton tooltip={item.title}>
                  {item.icon && cloneElement(item.icon)}
                  <span>{item.title}</span>
                  <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                </SidebarMenuButton>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarMenuSub>
                  {item.items.map((subItem) => (
                    <SidebarMenuSubItem key={subItem.title}>
                      <SidebarMenuSubButton asChild>
                        <NavLink
                          className="flex items-center gap-3 rounded px-3 py-2.5 font-semibold text-gray-700 transition-all duration-75 hover:bg-primary-50 hover:text-primary-600"
                          to={subItem.url}
                          data-test-id={`${subItem.title.toLowerCase()}SidebarMenuItem`}
                          title={subItem.title}
                        >
                          <span className="text whitespace-nowrap transition duration-200 ease-linear">
                            {subItem.title}
                          </span>
                        </NavLink>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  ))}
                </SidebarMenuSub>
              </CollapsibleContent>
            </SidebarMenuItem>
          </Collapsible>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
