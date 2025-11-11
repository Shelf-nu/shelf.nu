import { BookingStatus } from "@prisma/client";
import { useMatches } from "react-router";
import { ChevronRight } from "lucide-react";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { RouteHandleWithName } from "~/modules/types";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { resolveTeamMemberName } from "~/utils/user";
import { StatusFilter } from "./status-filter";
import DynamicDropdown from "../dynamic-dropdown/dynamic-dropdown";
import { Filters } from "../list/filters";
import { SortBy } from "../list/filters/sort-by";
import When from "../when/when";

const BOOKING_SORTING_OPTIONS = {
  from: "From Date",
  to: "To Date",
  name: "Name",
} as const;

type BookingFiltersProps = {
  className?: string;
  hideSortBy?: boolean;
};

export default function BookingFilters({
  className,
  hideSortBy = false,
}: BookingFiltersProps) {
  const { roles } = useUserRoleHelper();
  const organization = useCurrentOrganization();
  const matches = useMatches();

  const currentRoute: RouteHandleWithName = matches[matches.length - 1];

  const canSeeAllCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings,
  });

  const shouldRenderCustodianFilter =
    canSeeAllCustody &&
    !["$userId.bookings", "me.bookings"].includes(
      // on the user bookings page we dont want to show the custodian filter becuase they are alreayd filtered for that user
      currentRoute?.handle?.name
    );

  return (
    <Filters
      className={className}
      slots={{
        "left-of-search": <StatusFilter statusItems={BookingStatus} />,
        "right-of-search": hideSortBy ? null : (
          <SortBy
            sortingOptions={BOOKING_SORTING_OPTIONS}
            defaultSortingBy="from"
            defaultSortingDirection="asc"
          />
        ),
      }}
    >
      <When truthy={shouldRenderCustodianFilter}>
        <DynamicDropdown
          trigger={
            <div className="my-2 flex cursor-pointer items-center gap-2 md:my-0">
              Custodian <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{
            name: "teamMember",
            queryKey: "name",
            deletedAt: null,
          }}
          renderItem={(item) => resolveTeamMemberName(item, true)}
          label="Filter by custodian"
          placeholder="Search team members"
          initialDataKey="teamMembers"
          countKey="totalTeamMembers"
        />
      </When>

      <DynamicDropdown
        trigger={
          <div className="flex cursor-pointer items-center gap-2">
            Tags <ChevronRight className="hidden rotate-90 md:inline" />
          </div>
        }
        model={{ name: "tag", queryKey: "name" }}
        label="Filter by tag"
        initialDataKey="tags"
        countKey="totalTags"
        withoutValueItem={{
          id: "untagged",
          name: "Without tag",
        }}
      />
    </Filters>
  );
}
