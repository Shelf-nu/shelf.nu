import { OrganizationRoles } from "@prisma/client";
import { Outlet } from "@remix-run/react";
import HorizontalTabs from "~/components/layout/horizontal-tabs";
import type { Item } from "~/components/layout/horizontal-tabs/types";

const TABS: Item[] = [
  { to: "users", content: "Users" },
  { to: "nrm", content: "Non-registered members" },
];

export type UserFriendlyRoles = "Administrator" | "Owner" | "Self service";

export const organizationRolesMap: Record<string, UserFriendlyRoles> = {
  [OrganizationRoles.ADMIN]: "Administrator",
  [OrganizationRoles.OWNER]: "Owner",
  [OrganizationRoles.SELF_SERVICE]: "Self service",
};

export default function TeamSettings() {
  return (
    <div className="h-full rounded border bg-white p-4 md:px-10 md:py-8">
      <h1 className="text-[18px] font-semibold">Shelf’s team</h1>
      <p className="mb-6 text-sm text-gray-600">
        Manage your existing team and give team members custody to certain
        assets.
      </p>

      <HorizontalTabs items={TABS} />

      <Outlet />
    </div>
  );
}
