import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { Package } from "lucide-react";
import { useFetcher, useFetchers, useLoaderData } from "react-router";
import { List, type ListProps } from "~/components/list";
import { ListContentWrapper } from "~/components/list/content-wrapper";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { GrayBadge } from "~/components/shared/gray-badge";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import { Spinner } from "~/components/shared/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Th, Td } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import When from "~/components/when/when";
import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import { useAssetIndexViewState } from "~/hooks/use-asset-index-view-state";
import { useDisabled } from "~/hooks/use-disabled";
import { useIsAvailabilityView } from "~/hooks/use-is-availability-view";
import { useIsUserAssetsPage } from "~/hooks/use-is-user-assets-page";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { tw } from "~/utils/tw";
import { AssetImage } from "../asset-image";
import { AssetStatusBadge } from "../asset-status-badge";
import BulkActionsDropdown from "../bulk-actions-dropdown";
import { AdvancedAssetRow } from "./advanced-asset-row";
import { AdvancedTableHeader } from "./advanced-table-header";
import { AssetIndexPagination } from "./asset-index-pagination";
import AssetQuickActions from "./asset-quick-actions";
import { AssetIndexFilters } from "./filters";
import { ListItemTagsColumn } from "./list-item-tags-column";
import AvailabilityCalendar from "../../availability-calendar/availability-calendar";
import { CategoryBadge } from "../category-badge";
import { useAssetAvailabilityData } from "./use-asset-availability-data";

export const AssetsList = ({
  customEmptyState,
  disableTeamMemberFilter,
  disableBulkActions,
  wrapperClassName,
}: {
  customEmptyState?: ListProps["customEmptyStateContent"];
  disableTeamMemberFilter?: boolean;
  disableBulkActions?: boolean;
  wrapperClassName?: string;
}) => {
  const { items } = useLoaderData<AssetIndexLoaderData>();
  // We use the hook because it handles optimistic UI
  const { modeIsSimple } = useAssetIndexViewState();
  const { isAvailabilityView, shouldShowAvailabilityView } =
    useIsAvailabilityView();
  const columns = useAssetIndexColumns();
  const { isMd } = useViewportHeight();
  const isUserPage = useIsUserAssetsPage();
  const { isBase } = useUserRoleHelper();
  const fetchers = useFetchers();
  const { resources, events } = useAssetAvailabilityData(items);
  /** Find the fetcher used for toggling between asset index modes */
  const modeFetcher = fetchers.find(
    (fetcher) => fetcher.key === "asset-index-settings-mode"
  );
  const isSwappingMode = modeFetcher?.formData;
  const headerChildren = modeIsSimple ? (
    <>
      <Th>Category</Th>
      <Th>Tags</Th>
      <When truthy={!isUserPage}>
        <Th className="flex items-center gap-1 whitespace-nowrap">
          Custodian{" "}
          <InfoTooltip
            iconClassName="size-4"
            content={
              <>
                <h6>Asset custody</h6>
                <p>
                  This column shows if a user has custody of the asset either
                  via direct assignment or via a booking. If you see{" "}
                  <GrayBadge>private</GrayBadge> that means you don't have the
                  permissions to see who has custody of the asset.
                </p>
              </>
            }
          />
        </Th>
      </When>
      <Th>Location</Th>
      <Th>Actions</Th>
    </>
  ) : (
    <AdvancedTableHeader columns={columns} />
  );

  return (
    <div
      className={tw(
        "flex flex-col",
        modeIsSimple ? "gap-4 pb-5 pt-4" : "gap-2 py-2",
        isAvailabilityView ? "pb-3" : "",
        wrapperClassName,
        isSwappingMode && "overflow-hidden"
      )}
    >
      <When truthy={!!isSwappingMode}>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute inset-0 z-[100] flex flex-col items-center  bg-gray-25/95 pt-[30vh]"
        >
          <Spinner />
          <p className="mt-2">Changing mode...</p>
        </motion.div>
      </When>

      {!isMd && !modeIsSimple ? (
        <AdvancedModeMobileFallback />
      ) : (
        <ListContentWrapper className="md:mt-0">
          <AssetIndexFilters
            disableTeamMemberFilter={disableTeamMemberFilter}
          />
          {isAvailabilityView && shouldShowAvailabilityView ? (
            <>
              <AvailabilityCalendar
                resources={resources}
                events={events}
                resourceLabelContent={({ resource }) => (
                  <div className="flex items-center gap-2 px-2">
                    <AssetImage
                      asset={{
                        id: resource.id,
                        mainImage: resource.extendedProps?.mainImage,
                        thumbnailImage: resource.extendedProps?.thumbnailImage,
                        mainImageExpiration:
                          resource.extendedProps?.mainImageExpiration,
                      }}
                      alt={`Image of ${resource.title}`}
                      className="size-14 rounded border object-cover"
                      withPreview
                    />
                    <div className="flex flex-col gap-1">
                      <div className="min-w-0 flex-1 truncate">
                        <Button
                          to={`/assets/${resource.id}`}
                          variant="link"
                          className="text-left font-medium text-gray-900 hover:text-gray-700"
                          target={"_blank"}
                          onlyNewTabIconOnHover={true}
                        >
                          {resource.title}
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <AssetStatusBadge
                          id={resource.id}
                          status={resource.extendedProps?.status}
                          availableToBook={
                            resource.extendedProps?.availableToBook
                          }
                        />
                        <CategoryBadge
                          category={resource.extendedProps?.category}
                        />
                      </div>
                    </div>
                  </div>
                )}
              />
              <AssetIndexPagination />
            </>
          ) : (
            <List
              title="Assets"
              ItemComponent={modeIsSimple ? ListAssetContent : AdvancedAssetRow}
              customPagination={<AssetIndexPagination />}
              bulkActions={
                disableBulkActions || isBase ? undefined : (
                  <BulkActionsDropdown />
                )
              }
              customEmptyStateContent={
                customEmptyState ? customEmptyState : undefined
              }
              headerChildren={headerChildren}
            />
          )}
        </ListContentWrapper>
      )}
    </div>
  );
};

export const ListAssetContent = ({
  item,
  bulkActions,
  isUserPage,
}: {
  item: AssetsFromViewItem;
  bulkActions?: ReactNode;
  isUserPage?: boolean;
}) => {
  const { category, tags, custody, location, kit } = item;
  return (
    <>
      {/* Item */}
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div
          className={tw(
            "flex justify-between gap-3 py-4  md:justify-normal",
            bulkActions ? "md:pl-0 md:pr-6" : "md:px-6"
          )}
        >
          <div className="flex items-center gap-3">
            <div className="relative flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={`Image of ${item.title}`}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />

              {kit?.id ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-white bg-gray-200">
                        <Package className="size-2" />
                      </div>
                    </TooltipTrigger>

                    <TooltipContent side="top">
                      <p className="text-sm">{kit.name}</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
            <div className="min-w-[130px]">
              <span className="word-break mb-1 block ">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                >
                  {item.title}
                </Button>
              </span>
              <div>
                <AssetStatusBadge
                  id={item.id}
                  status={item.status}
                  availableToBook={item.availableToBook}
                />
              </div>
            </div>
          </div>
        </div>
      </Td>

      {/* Category */}
      <Td>
        <CategoryBadge category={category} />
      </Td>

      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>

      {/* Custodian */}
      <When truthy={!isUserPage}>
        <Td>
          {custody?.custodian ? (
            <TeamMemberBadge teamMember={custody.custodian} />
          ) : (
            <EmptyTableValue />
          )}
        </Td>
      </When>

      {/* Location */}
      <Td>
        {location ? (
          <LocationBadge
            location={{
              id: location.id,
              name: location.name,
              parentId: location.parentId ?? undefined,
              childCount: location._count?.children ?? 0,
            }}
          />
        ) : (
          <EmptyTableValue />
        )}
      </Td>

      {/* Quick Actions */}
      <Td>
        <AssetQuickActions
          asset={{
            ...item,
            qrId: item.qrCodes?.[0]?.id,
          }}
        />
      </Td>
    </>
  );
};

function AdvancedModeMobileFallback() {
  const fetcher = useFetcher();
  const disabled = useDisabled(fetcher);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="text-center">
        Advanced mode is currently not available on mobile.
      </p>
      <fetcher.Form
        method="post"
        action="/api/asset-index-settings"
        onSubmit={() => {
          window.scrollTo({
            top: 0,
            behavior: "smooth",
          });
        }}
      >
        <input type="hidden" name="intent" value="changeMode" />

        <Button name="mode" value="SIMPLE" disabled={disabled}>
          Change to simple mode
        </Button>
      </fetcher.Form>
    </div>
  );
}
