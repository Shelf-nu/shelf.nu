import { AssetStatus } from "@prisma/client";
import { StatusFilter } from "~/components/booking/status-filter";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { Button } from "~/components/shared/button";
import { Image } from "~/components/shared/image";
import When from "~/components/when/when";
import {
  useClearValueFromParams,
  useSearchParamHasValue,
} from "~/hooks/search-params";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { resolveTeamMemberName } from "~/utils/user";
import { AdvancedFilteringAndSorting } from "./advanced-asset-index-filters-and-sorting";
import { ConfigureColumnsDropdown } from "./configure-columns-dropdown";

const ASSET_INDEX_SORTING_OPTIONS = {
  title: "Name",
  createdAt: "Date created",
  updatedAt: "Date updated",
} as const;

export function AssetIndexFilters({
  disableTeamMemberFilter,
}: {
  disableTeamMemberFilter?: boolean;
}) {
  /** Used for filtering based on user type */
  const searchParams: string[] = ["category", "tag", "location"];
  if (!disableTeamMemberFilter) {
    searchParams.push("teamMember");
  }
  const hasFiltersToClear = useSearchParamHasValue(...searchParams);
  const clearFilters = useClearValueFromParams(...searchParams);
  const { roles } = useUserRoleHelper();

  const { modeIsSimple, modeIsAdvanced } = useAssetIndexViewState();

  if (modeIsSimple) {
    return (
      <Filters
        slots={{
          "left-of-search": <StatusFilter statusItems={AssetStatus} />,
          "right-of-search": (
            <SortBy
              sortingOptions={ASSET_INDEX_SORTING_OPTIONS}
              defaultSortingBy="createdAt"
            />
          ),
        }}
      >
        <div className="flex w-full items-center justify-around gap-6 md:w-auto md:justify-end">
          {hasFiltersToClear ? (
            <div className="hidden gap-6 md:flex">
              <Button
                as="button"
                onClick={clearFilters}
                variant="link"
                className="block min-w-28 max-w-none font-normal text-gray-500 hover:text-gray-600"
                type="button"
              >
                Clear all filters
              </Button>
              <div className="text-gray-500"> | </div>
            </div>
          ) : null}

          <div className="flex w-full items-center justify-around gap-2 p-3 md:w-auto md:justify-end md:p-0 lg:gap-4">
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Categories{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "category", queryKey: "name" }}
              label="Filter by category"
              placeholder="Search categories"
              initialDataKey="categories"
              countKey="totalCategories"
              withoutValueItem={{
                id: "uncategorized",
                name: "Uncategorized",
              }}
            />
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
            <DynamicDropdown
              trigger={
                <div className="flex cursor-pointer items-center gap-2">
                  Locations{" "}
                  <ChevronRight className="hidden rotate-90 md:inline" />
                </div>
              }
              model={{ name: "location", queryKey: "name" }}
              label="Filter by location"
              initialDataKey="locations"
              countKey="totalLocations"
              withoutValueItem={{
                id: "without-location",
                name: "Without location",
              }}
              renderItem={({ metadata }) => (
                <div className="flex items-center gap-2">
                  <Image
                    imageId={metadata.imageId}
                    alt="img"
                    className={tw(
                      "size-6 rounded-[2px] object-cover",
                      metadata.description ? "rounded-b-none border-b-0" : ""
                    )}
                  />
                  <div>{metadata.name}</div>
                </div>
              )}
            />
            <When
              truthy={
                userHasPermission({
                  roles,
                  entity: PermissionEntity.custody,
                  action: PermissionAction.read,
                }) && !disableTeamMemberFilter
              }
            >
              <DynamicDropdown
                trigger={
                  <div className="flex cursor-pointer items-center gap-2">
                    Custodian{" "}
                    <ChevronRight className="hidden rotate-90 md:inline" />
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
                withoutValueItem={{
                  id: "without-custody",
                  name: "Without custody",
                }}
              />
            </When>
          </div>
        </div>
      </Filters>
    );
  }

  if (modeIsAdvanced) {
    return <AdvancedAssetIndexFilters />;
  }
}

function AdvancedAssetIndexFilters() {
  return (
    <Filters
      slots={{
        "left-of-search": <AdvancedFilteringAndSorting />,
      }}
      searchClassName="leading-5"
    >
      <div className="flex w-full items-center justify-around gap-6 md:w-auto md:justify-end">
        <Button
          variant="link"
          target="_blank"
          to="https://www.shelf.nu/knowledge-base/advanced-asset-index"
          className="whitespace-nowrap"
        >
          Advanced Index - Explained
        </Button>
        <ConfigureColumnsDropdown />
      </div>
    </Filters>
  );
}
