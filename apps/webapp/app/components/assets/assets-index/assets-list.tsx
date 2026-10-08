import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import { m } from "framer-motion";
import { useSetAtom } from "jotai";
import { Package } from "lucide-react";
import { useFetcher, useFetchers, useLoaderData } from "react-router";
import { setDisabledBulkItemsAtom } from "~/atoms/list";
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
import { AssetIndexSettingsProvider } from "~/context/asset-index-settings-context";
import { useAssetIndexColumns } from "~/hooks/use-asset-index-columns";
import { useAssetIndexView } from "~/hooks/use-asset-index-view";
import { useCanArchiveAssets } from "~/hooks/use-can-archive-assets";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useDisabled } from "~/hooks/use-disabled";
import { useIsUserAssetsPage } from "~/hooks/use-is-user-assets-page";
import { useOrganizationRoles } from "~/hooks/use-organization-roles";
import { useViewportHeight } from "~/hooks/use-viewport-height";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import { getPrimaryLocation, isQuantityTracked } from "~/modules/asset/utils";
import type { AssetModelRollupRow } from "~/modules/asset-model/rollup.server";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { formatCustodyList } from "~/modules/custody/utils";
import type { AssetIndexLoaderData } from "~/routes/_layout+/assets._index";
import { isPersonalOrg } from "~/utils/organization";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { tw } from "~/utils/tw";
import { AssetCodeBadge } from "../asset-code-badge";
import { AssetImage } from "../asset-image";
import { AssetStatusBadge } from "../asset-status-badge";
import BulkActionsDropdown from "../bulk-actions-dropdown";
import { AdvancedAssetRow } from "./advanced-asset-row";
import { AdvancedTableHeader } from "./advanced-table-header";
import { ArchivedViewToggle } from "./archived-view-toggle";
import { AssetIndexPagination } from "./asset-index-pagination";
import { AssetModelRow } from "./asset-model-row";
import { AssetModelSortHeader } from "./asset-model-sort-header";
import AssetQuickActions from "./asset-quick-actions";
import { AssetIndexFilters } from "./filters";
import { ListItemTagsColumn } from "./list-item-tags-column";
import BookSelectedModelsDropdown from "./model-booking/book-selected-models-dropdown";
import { getUnselectableModelRows } from "./model-booking/unselectable-model-rows";
import { useAssetAvailabilityData } from "./use-asset-availability-data";
import AvailabilityCalendar from "../../availability-calendar/availability-calendar";
import { ResourceTitleLink } from "../../availability-calendar/resource-title-link";
import { CategoryBadge } from "../category-badge";

/**
 * The model view's bulk-action toolbar, built once.
 *
 * `List` hands this element to every row it renders, and `AssetModelRow` is
 * memoised — a fresh element on each render would give the memo a new prop
 * identity every time and re-render every row. Module scope is what keeps
 * that identity stable.
 */
const MODEL_BULK_ACTIONS = <BookSelectedModelsDropdown />;

/**
 * What an asset model is, in one sentence.
 *
 * A workspace with no models has to be told this in two different places: a line
 * above a list that still has rows, and the empty state when it has none. One
 * constant so the two cannot drift into describing the feature differently.
 */
const ASSET_MODEL_EXPLAINER =
  "A model is a make and specification that several assets share, so a booking can ask for any unit of it.";

/**
 * The fill every header cell of the model view carries.
 *
 * `Th` draws no background of its own, so each cell in the group has to ask for
 * this one by name. A cell that leaves it out renders transparent next to its
 * tinted neighbours, which reads as a block of colour sitting over a single
 * column rather than as a header row.
 */
const MODEL_HEADER_FILL = "bg-gray-25";

export const AssetsList = ({
  customEmptyStateContent,
  disableTeamMemberFilter,
  disableBulkActions,
  wrapperClassName,
}: {
  customEmptyStateContent?: ListProps["customEmptyStateContent"];
  disableTeamMemberFilter?: boolean;
  disableBulkActions?: boolean;
  wrapperClassName?: string;
}) => {
  const {
    items,
    modelRollup,
    totalRollupAssets,
    totalModels,
    totalAssetModels,
    locale,
  } = useLoaderData<AssetIndexLoaderData>();
  // We use the hook because it handles optimistic UI
  const {
    isAvailabilityView,
    shouldShowAvailabilityView,
    isModelView,
    modeIsSimple,
  } = useAssetIndexView();
  const columns = useAssetIndexColumns();
  // Memoize so the object reference stays stable across re-renders,
  // allowing React.memo on AdvancedAssetRow to work effectively.
  const advancedExtraProps = useMemo(() => ({ columns }), [columns]);
  const { isMd } = useViewportHeight();
  const isUserPage = useIsUserAssetsPage();
  const roles = useOrganizationRoles();
  /** The bulk menu holds custody, edit and delete actions; any one opens it. */
  const canBulkAct = userHasPermission({
    roles,
    entity: PermissionEntity.asset,
    action: [
      PermissionAction.custody,
      PermissionAction.update,
      PermissionAction.delete,
    ],
  });
  const canArchiveAssets = useCanArchiveAssets();
  const fetchers = useFetchers();
  const { resources, events } = useAssetAvailabilityData(items);
  // Workspace pref + addon entitlement — used by the availability-view
  // resourceLabelContent to render AssetCodeBadge next to status + category.
  // resolveDisplayCode short-circuits to QR for non-addon orgs, so always safe.
  const currentOrganization = useCurrentOrganization();
  // The header's model count. Three candidates, and only one is right:
  // `modelRollup.length` is this page's rows, `totalItems` is every row the
  // list renders (bucket included), and `totalModels` is the unpaged count of
  // real models — which is what "N models" claims to be.
  const totalModelsShown = isModelView ? totalModels : 0;
  // Stable `id` per row (react-list-item key + click targeting) — the rollup
  // row's natural identifier is `assetModelId`, which is `null` for the
  // synthetic "No model" bucket.
  const modelRollupItems = useMemo(
    () =>
      (modelRollup ?? []).map((row: AssetModelRollupRow) => ({
        ...row,
        id: row.assetModelId ?? "no-model",
      })),
    [modelRollup]
  );
  // Memoized so `AssetModelRow`'s `memo()` wrapper is not defeated by a new
  // object identity on every render (see react-render-stability rule).
  const modelExtraProps = useMemo(
    () => ({ locale, currency: currentOrganization?.currency }),
    [locale, currentOrganization?.currency]
  );
  /**
   * Selection on the model view exists to feed the booking dropdown, so it is
   * offered only where that dropdown has something to open: never in a
   * personal workspace, which has no bookings, and never to a role that cannot
   * create one. Withholding the element also withholds the checkbox column,
   * which `List` renders only when `bulkActions` is present.
   */
  const canBookSelectedModels =
    !disableBulkActions &&
    !isPersonalOrg(currentOrganization) &&
    userHasPermission({
      roles,
      entity: PermissionEntity.booking,
      action: PermissionAction.create,
    });
  /**
   * Whether the viewer may create asset models, which decides whether the
   * empty-workspace line hands them a link or tells them who can. BASE reads
   * models but cannot add one, so linking every viewer there would send some of
   * them to a 403.
   */
  const canCreateAssetModels = userHasPermission({
    roles,
    entity: PermissionEntity.assetModel,
    action: PermissionAction.create,
  });
  /**
   * The model view's column headers.
   *
   * Every column the rollup can order by is a sort control; Default category is
   * not, because `getAssetModelRollup` has no sort expression for it and an
   * unsupported key falls back to name, leaving a header that shows a direction
   * the list is not in.
   *
   * The name header is here rather than in `ListHeader` (see
   * `hideFirstHeaderColumn` below), so its cell classes are mirrored from there
   * to keep the two views' headers aligned. The freeze classes are not, because
   * this view renders unfrozen.
   */
  const modelHeaderChildren = useMemo(
    () => (
      <>
        <AssetModelSortHeader
          sortKey="name"
          label="Name"
          columnName="name"
          className={tw(
            "!border-b-0 border-r border-r-transparent",
            MODEL_HEADER_FILL,
            canBookSelectedModels ? "!pl-0" : ""
          )}
        />
        {/* "Default category", not "Category": the cell shows the model's
            DEFAULT, which applies at creation only, so its assets may sit in
            other categories. */}
        <Th className={MODEL_HEADER_FILL}>Default category</Th>
        <AssetModelSortHeader
          sortKey="assets"
          label="Assets"
          className={MODEL_HEADER_FILL}
        />
        {/* "Status", not "Availability": the cell counts asset status, which is
            not what a booking can take. See `StatusSplit`. The cell carries
            three counts and the rollup can order by the first of them, so the
            control names which one rather than leaving a reader to work out
            what moved. */}
        <AssetModelSortHeader
          sortKey="available"
          label="Status"
          sortsBy="assets in"
          className={MODEL_HEADER_FILL}
        />
        <AssetModelSortHeader
          sortKey="value"
          label="Total value"
          className={MODEL_HEADER_FILL}
        />
      </>
    ),
    [canBookSelectedModels]
  );
  const setDisabledBulkItems = useSetAtom(setDisabledBulkItemsAtom);
  // The "No model" bucket is not a model, so there are no units of it to
  // reserve. It stays on the page — it answers "what has no model assigned" —
  // and is registered as disabled so its checkbox refuses the click. Cleared
  // on the other views, whose rows are all selectable: the view lives in a
  // search param, which no route-change reset reaches.
  useEffect(() => {
    setDisabledBulkItems(
      isModelView ? getUnselectableModelRows(modelRollupItems) : []
    );
  }, [isModelView, modelRollupItems, setDisabledBulkItems]);
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
      <Th>Quantity</Th>
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
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ delay: 0.2 }}
          className="absolute inset-0 z-[100] flex flex-col items-center  bg-gray-25/95 pt-[30vh]"
        >
          <Spinner />
          <p className="mt-2">Changing mode...</p>
        </m.div>
      </When>

      {!isMd && !modeIsSimple ? (
        <AdvancedModeMobileFallback />
      ) : (
        <ListContentWrapper className="md:mt-0">
          <AssetIndexFilters
            disableTeamMemberFilter={disableTeamMemberFilter}
          />
          {isModelView ? (
            <>
              <div className="-mb-2 flex flex-col gap-1 px-1 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                  <span>
                    {`${totalRollupAssets} ${
                      totalRollupAssets === 1 ? "asset" : "assets"
                    } match your filters`}
                  </span>
                  {/* The asset count here is deliberately smaller than the list
                      view's for the same filters: models are an INDIVIDUAL-only
                      concept, so quantity-tracked assets are not part of this
                      rollup. Stated rather than left for the reader to discover
                      as apparent data loss when switching views. */}
                  <InfoTooltip
                    iconClassName="size-4"
                    content={
                      <>
                        <h6>Asset models</h6>
                        <p>
                          Counts cover the assets matching your current filters.
                          Asset models apply to individually-tracked assets
                          only, so quantity-tracked assets are not included
                          here.
                        </p>
                      </>
                    }
                  />
                </div>
                {/* Reads the workspace's own model count, not the rollup's.
                    `totalAssetModels` counts AssetModel rows in the
                    organization and no filter narrows it, so this says "this
                    workspace has no models" and can never be mistaken for "no
                    models match these filters", which is a different state with
                    a model count above zero. Without this line a workspace that
                    has never used models shows "0 asset models" over a list of
                    unassigned assets, with nothing saying what a model is or
                    where one is made.

                    Skipped when the list has no rows at all, where the empty
                    state says the same thing with room for a full call to
                    action. A list with rows is the common case: a workspace with
                    unassigned individually-tracked assets renders the "No
                    model" row, so no empty state mounts to carry the message. */}
                <When
                  truthy={totalAssetModels === 0 && modelRollupItems.length > 0}
                >
                  <p>
                    No asset models in this workspace yet.{" "}
                    {ASSET_MODEL_EXPLAINER}{" "}
                    {canCreateAssetModels ? (
                      <Button
                        to="/settings/asset-models/new"
                        variant="link"
                        className="font-normal"
                      >
                        Create an asset model
                      </Button>
                    ) : (
                      <span>
                        A workspace administrator creates them in settings.
                      </span>
                    )}
                  </p>
                </When>
              </div>
              {/* Freezing is switched off here: it pins the header's name
                  cell with `sticky left-[48px]`, and `AssetModelRow` applies no
                  matching class to the name cell beneath it — so the pinned
                  header would slide over unpinned body cells. */}
              <AssetIndexSettingsProvider freezeColumn={false}>
                <List
                  title="Asset models"
                  // The ONLY model count on this screen. `totalItems` counts
                  // rendered rows, which includes the "No model" bucket, and a
                  // bucket is not a model; `totalModels` excludes it. Two
                  // counts of the same thing disagreeing is worse than either.
                  countLabelIsTotal
                  countLabel={() =>
                    `${totalModelsShown} ${
                      totalModelsShown === 1 ? "asset model" : "asset models"
                    }`
                  }
                  ItemComponent={AssetModelRow}
                  customPagination={<AssetIndexPagination />}
                  // The name header is drawn here rather than by `ListHeader`,
                  // for two reasons that both only hold on this view: it has to
                  // be a sort control, and `ListHeader`'s own name cell carries
                  // the advanced-mode options popover, whose "Freeze column"
                  // and "Hide asset image" both configure the asset list and
                  // neither reaches a model row.
                  hideFirstHeaderColumn
                  headerChildren={modelHeaderChildren}
                  items={modelRollupItems}
                  extraItemComponentProps={modelExtraProps}
                  bulkActions={
                    canBookSelectedModels ? MODEL_BULK_ACTIONS : undefined
                  }
                  // "Select all N entries" has no meaning here: both booking
                  // endpoints take an explicit list of models with a quantity
                  // each, so a marker standing for "every model matching the
                  // filters" would reserve only the page in front of the user
                  // while the header claimed the whole set.
                  disableSelectAllItems
                  // The zero-data slot, not the filtered one. `EmptyState`
                  // renders its own "nothing matched" copy whenever a search or
                  // a filter is set and reaches this content only when none is,
                  // so copy about filters here is shown exactly when no filter
                  // was applied.
                  //
                  // Reaching it at all takes an empty rollup with no filters
                  // active: no model rows, and nothing in the "No model" row
                  // either. The call to action is the model, because that is the
                  // part a reader can act on from here.
                  customEmptyStateContent={{
                    title: "No asset models yet",
                    text: ASSET_MODEL_EXPLAINER,
                    ...(canCreateAssetModels
                      ? {
                          newButtonRoute: "/settings/asset-models/new",
                          newButtonContent: "New asset model",
                          // `EmptyState` names its default button after the
                          // loader's model, which is the asset. Spread last, so
                          // this is the accessible name that survives.
                          buttonProps: { "aria-label": "New asset model" },
                        }
                      : {}),
                  }}
                />
              </AssetIndexSettingsProvider>
            </>
          ) : isAvailabilityView && shouldShowAvailabilityView ? (
            <>
              <AvailabilityCalendar
                resources={resources}
                events={events}
                resourceLabelContent={({ resource }) => {
                  const displayCode = currentOrganization
                    ? resolveDisplayCode({
                        entity: {
                          sequentialId: resource.extendedProps?.sequentialId,
                          preferredBarcodeId:
                            resource.extendedProps?.preferredBarcodeId,
                          qrCodes: resource.extendedProps?.qrCodes,
                          barcodes: resource.extendedProps?.barcodes,
                        },
                        organization: currentOrganization,
                        entityKind: "asset",
                      })
                    : null;
                  return (
                    <div className="flex items-center gap-2 px-2">
                      <AssetImage
                        asset={{
                          id: resource.id,
                          mainImage: resource.extendedProps?.mainImage,
                          thumbnailImage:
                            resource.extendedProps?.thumbnailImage,
                          mainImageExpiration:
                            resource.extendedProps?.mainImageExpiration,
                          assetModel:
                            resource.extendedProps?.assetModel ?? null,
                        }}
                        alt={`Image of ${resource.title}`}
                        className="size-14 shrink-0 rounded border object-cover"
                        withPreview
                      />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <ResourceTitleLink
                          to={`/assets/${resource.id}`}
                          title={resource.title}
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <AssetStatusBadge
                            id={resource.id}
                            status={resource.extendedProps?.status}
                            availableToBook={
                              resource.extendedProps?.availableToBook
                            }
                            asset={resource.extendedProps}
                          />
                          <CategoryBadge
                            category={resource.extendedProps?.category}
                          />
                          {displayCode ? (
                            <AssetCodeBadge {...displayCode} />
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              <AssetIndexPagination />
            </>
          ) : (
            <List
              title="Assets"
              ItemComponent={modeIsSimple ? ListAssetContent : AdvancedAssetRow}
              customPagination={<AssetIndexPagination />}
              bulkActions={
                disableBulkActions || !canBulkAct ? undefined : (
                  <BulkActionsDropdown />
                )
              }
              customEmptyStateContent={
                customEmptyStateContent ? customEmptyStateContent : undefined
              }
              /**
               * Active/Archived/All lives beside the item count, not in the
               * filter row (issue #382). It is a view SCOPE, not a filter —
               * it is in NON_FILTER_PARAMS and Clear Filters leaves it alone —
               * and it changes what "N assets out of M" counts, so it belongs
               * next to that number. The filter row was also full: 12 controls
               * ending 33px short of a 1440px viewport, where this took 14%.
               * One slot serves both index modes, so it cannot drift.
               */
              headerTitleContent={
                canArchiveAssets ? <ArchivedViewToggle /> : undefined
              }
              headerChildren={headerChildren}
              extraItemComponentProps={
                modeIsSimple ? undefined : advancedExtraProps
              }
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
  const { category, tags, custody: custodyArray } = item;
  // Render only the single primary-location badge in the list column —
  // a qty-tracked asset can sit at multiple locations via AssetLocation.
  const location = getPrimaryLocation(item);
  const kit = item.assetKits?.[0]?.kit ?? null;
  const {
    primary: primaryCustody,
    others: otherCustodians,
    total: totalCustodians,
  } = formatCustodyList(custodyArray);
  const currentOrganization = useCurrentOrganization();
  const displayCode = currentOrganization
    ? resolveDisplayCode({
        entity: item,
        organization: currentOrganization,
        entityKind: "asset",
      })
    : null;
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
                  assetModel: item.assetModel ?? null,
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
              {/*
                Single metadata line: status badge first (most glanceable —
                color + word), code chip second (identification reference).
                Reads as paired metadata, frees a row of vertical space vs.
                the previous three-stack layout. `flex-wrap` keeps the layout
                safe when code/status are long on narrow viewports.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <AssetStatusBadge
                  id={item.id}
                  status={item.status}
                  availableToBook={item.availableToBook}
                  asset={item}
                  isArchived={!!item.archivedAt}
                />
                {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
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
          {!primaryCustody || totalCustodians === 0 ? (
            <EmptyTableValue />
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex min-w-0 items-center">
                <TeamMemberBadge teamMember={primaryCustody.custodian} />
                {primaryCustody.quantity && primaryCustody.quantity > 1 ? (
                  <span className="ml-1 shrink-0 text-gray-500">
                    ({primaryCustody.quantity})
                  </span>
                ) : null}
              </span>
              {otherCustodians.length > 0 ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="shrink-0 cursor-help whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 focus-visible:ring-offset-1"
                        aria-label={`+${otherCustodians.length} more custodian${
                          otherCustodians.length === 1 ? "" : "s"
                        }`}
                      >
                        +{otherCustodians.length}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <ul className="flex flex-col gap-1 text-sm">
                        {[primaryCustody, ...otherCustodians].map((entry) => {
                          const name = entry.custodian?.name ?? "Unknown";
                          const qty = entry.quantity;
                          // why: Custody rows carry their own `id`; fall back
                          // to a name+qty composite only when missing (the
                          // upstream `formatCustodyList` type is generic, so
                          // TS can't prove `id` is present without a cast).
                          const key =
                            (entry as { id?: string }).id ?? `${name}-${qty}`;
                          return (
                            <li key={key}>
                              {name}
                              {qty && qty > 1 ? ` (${qty})` : null}
                            </li>
                          );
                        })}
                      </ul>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </span>
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

      {/* Quantity */}
      <Td>
        {isQuantityTracked(item) && item.quantity != null ? (
          <span>
            {item.quantity}
            {item.unitOfMeasure ? ` ${item.unitOfMeasure}` : ""}
          </span>
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

        <Button type="submit" name="mode" value="SIMPLE" disabled={disabled}>
          Change to simple mode
        </Button>
      </fetcher.Form>
    </div>
  );
}
