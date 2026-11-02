import { BookingStatus } from "@prisma/client";
import { ChevronRight } from "lucide-react";
import { useMatches } from "react-router";
import { useBookingSettings } from "~/hooks/use-booking-settings";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import type { RouteHandleWithName } from "~/modules/types";
import { PENDING_APPROVAL_STATUS_FILTER } from "~/utils/bookings";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { resolveTeamMemberName } from "~/utils/user";
import { StatusFilter } from "./status-filter";
import DynamicDropdown from "../dynamic-dropdown/dynamic-dropdown";
import { Filters } from "../list/filters";
import { SortBy } from "../list/filters/sort-by";
import When from "../when/when";

/**
 * The status picker's options when the workspace requires approval: every
 * BookingStatus plus "Pending approval", placed right after RESERVED, the
 * status it narrows. Not a BookingStatus; the list resolves it server-side.
 */
const STATUS_ITEMS_WITH_PENDING_APPROVAL: Record<string, string> = {
  [BookingStatus.DRAFT]: BookingStatus.DRAFT,
  [BookingStatus.RESERVED]: BookingStatus.RESERVED,
  [PENDING_APPROVAL_STATUS_FILTER]: PENDING_APPROVAL_STATUS_FILTER,
  ...Object.fromEntries(
    Object.values(BookingStatus)
      .filter(
        (status) =>
          status !== BookingStatus.DRAFT && status !== BookingStatus.RESERVED
      )
      .map((status) => [status, status])
  ),
};

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
  const roles = useOrganizationRoles();
  const organization = useCurrentOrganization();
  const { requireBookingApproval } = useBookingSettings();
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
        "left-of-search": (
          <StatusFilter
            statusItems={
              requireBookingApproval
                ? STATUS_ITEMS_WITH_PENDING_APPROVAL
                : BookingStatus
            }
          />
        ),
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
            // A read FILTER, so the workspace custody override governs. Without
            // this the endpoint applies its stricter assignment default and the
            // list shrinks the moment the user types.
            custodyPurpose: "custody-filter",
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
