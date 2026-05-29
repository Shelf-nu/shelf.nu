import type {
  Asset,
  BarcodeType,
  Category,
  Location,
  Tag,
} from "@prisma/client";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import { data, useLoaderData, useParams } from "react-router";
import z from "zod";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import AssetRowActionsDropdown from "~/components/location/asset-row-actions-dropdown";
import ListBulkActionsDropdown from "~/components/location/list-bulk-actions-dropdown";
import { Button } from "~/components/shared/button";
import { EmptyTableValue } from "~/components/shared/empty-table-value";
import { GrayBadge } from "~/components/shared/gray-badge";
import { InfoTooltip } from "~/components/shared/info-tooltip";
import TextualDivider from "~/components/shared/textual-divider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Td, Th } from "~/components/table";
import { TeamMemberBadge } from "~/components/user/team-member-badge";
import When from "~/components/when/when";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { hasGetAllValue } from "~/hooks/use-model-filters";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { isQuantityTracked } from "~/modules/asset/utils";
import { resolveDisplayCode } from "~/modules/barcode/display";
import { resolveLocationAssetIds } from "~/modules/location/bulk-select.server";
import {
  getLocation,
  updateLocationAssets,
} from "~/modules/location/service.server";
import { getTeamMemberForCustodianFilter } from "~/modules/team-member/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { updateCookieWithPerPage } from "~/utils/cookies.server";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import {
  payload,
  error,
  getCurrentSearchParams,
  getParams,
  parseData,
} from "~/utils/http.server";
import { getParamsValues } from "~/utils/list";
import type { OrganizationPermissionSettings } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import { userHasCustodyViewPermission } from "~/utils/permissions/custody-and-bookings-permissions.validator.client";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { requirePermission } from "~/utils/roles.server";
import { resolveTeamMemberName } from "~/utils/user";

const paramsSchema = z.object({ locationId: z.string() });

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, paramsSchema);

  try {
    const { organizationId, userOrganizations, canSeeAllCustody } =
      await requirePermission({
        request,
        userId,
        entity: PermissionEntity.location,
        action: PermissionAction.read,
      });

    const searchParams = getCurrentSearchParams(request);
    const {
      page,
      perPageParam,
      search,
      orderBy,
      orderDirection,
      teamMemberIds,
    } = getParamsValues(searchParams);
    const cookie = await updateCookieWithPerPage(request, perPageParam);
    const { perPage } = cookie;

    const [
      // `assets` is returned alongside `location` — there is no direct
      // Location.assets relation; getLocation runs a separate pivot-filtered
      // findMany and synthesizes the array here.
      { location, totalAssetsWithinLocation, assets },
      { teamMembers, totalTeamMembers },
    ] = await Promise.all([
      getLocation({
        organizationId,
        id: locationId,
        page,
        perPage,
        search,
        orderBy,
        orderDirection,
        userOrganizations,
        request,
        teamMemberIds,
      }),
      getTeamMemberForCustodianFilter({
        organizationId,
        selectedTeamMembers: teamMemberIds,
        getAll:
          searchParams.has("getAll") &&
          hasGetAllValue(searchParams, "teamMember"),
        // When the user cannot see all custody, only return their own team member
        filterByUserId: !canSeeAllCustody,
        userId,
      }),
    ]);

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const totalItems = totalAssetsWithinLocation;
    const totalPages = Math.ceil(totalAssetsWithinLocation / perPage);

    const header: HeaderData = {
      title: `${location.name} - Assets`,
      subHeading: location.id,
    };

    return payload({
      location,
      header,
      modelName,
      items: assets,
      page,
      totalItems,
      perPage,
      totalPages,
      teamMembers,
      totalTeamMembers,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const { userId } = context.getSession();
  const { locationId } = getParams(params, paramsSchema);

  try {
    const { organizationId } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.location,
      action: PermissionAction.manageAssets,
    });

    const formData = await request.formData();
    const intent = formData.get("intent") as string;

    switch (intent) {
      case "removeAsset": {
        const { assetId } = parseData(
          formData,
          z.object({ assetId: z.string() })
        );

        await updateLocationAssets({
          organizationId,
          locationId,
          userId,
          request,
          assetIds: [],
          removedAssetIds: [assetId],
        });

        sendNotification({
          title: "Asset removed",
          message: "Asset has been removed from this location",
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ success: true });
      }

      case "bulk-remove-assets": {
        const { assetIds } = parseData(
          formData,
          z.object({
            assetIds: z.array(z.string()).min(1),
          })
        );

        const resolvedAssetIds = await resolveLocationAssetIds({
          ids: assetIds,
          organizationId,
          locationId,
          request,
        });

        if (resolvedAssetIds.length === 0) {
          return payload({
            success: true,
            message: "No assets matched the current selection",
          });
        }

        await updateLocationAssets({
          organizationId,
          locationId,
          userId,
          request,
          assetIds: [],
          removedAssetIds: resolvedAssetIds,
        });

        sendNotification({
          title: "Assets removed",
          message: `${resolvedAssetIds.length} asset(s) removed from this location`,
          icon: { name: "success", variant: "success" },
          senderId: userId,
        });

        return payload({ success: true });
      }

      default:
        throw new Error(`Unsupported intent: ${intent}`);
    }
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return data(error(reason), { status: reason.status });
  }
}

export default function LocationAssets() {
  const { roles } = useUserRoleHelper();
  const { location } = useLoaderData<typeof loader>();
  const userRoleCanManageAssets = userHasPermission({
    roles,
    entity: PermissionEntity.location,
    action: PermissionAction.manageAssets,
  });

  const organization = useCurrentOrganization();
  const canReadCustody = userHasCustodyViewPermission({
    roles,
    organization: organization as OrganizationPermissionSettings, // Here we can be sure as TeamMemberBadge is only used in the context of an organization/logged in route
  });

  return (
    <>
      <ContextualSidebar />
      <ContextualModal />

      <TextualDivider text="Assets" className="mb-4 lg:hidden" />
      <div className="flex flex-col md:gap-2">
        <Filters
          className="responsive-filters mb-2 lg:mb-0"
          slots={{
            "right-of-search": (
              <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
                <SortBy
                  sortingOptions={ASSET_SORTING_OPTIONS}
                  defaultSortingBy="createdAt"
                />
                <When truthy={canReadCustody}>
                  <DynamicDropdown
                    trigger={
                      <div className="flex items-center gap-2">
                        Custodian
                        <ChevronRight className="rotate-90" />
                      </div>
                    }
                    triggerWrapperClassName="h-[42px] w-full whitespace-nowrap rounded border border-gray-300 px-[14px] text-[14px] text-gray-500 hover:cursor-pointer md:w-auto"
                    model={{
                      name: "teamMember",
                      queryKey: "name",
                      deletedAt: null,
                    }}
                    label="Filter by custodian"
                    placeholder="Search team members"
                    initialDataKey="teamMembers"
                    countKey="totalTeamMembers"
                    withoutValueItem={{
                      id: "without-custody",
                      name: "Without custody",
                    }}
                    renderItem={(item) => resolveTeamMemberName(item, true)}
                  />
                </When>
              </div>
            ),
          }}
        >
          <div className="mt-2 flex w-full items-center gap-2 md:mt-0">
            <When truthy={userRoleCanManageAssets}>
              <Button
                icon="scan"
                variant="secondary"
                to={`/locations/${location.id}/scan-assets-kits`}
                width="full"
              >
                Scan
              </Button>
              <Button
                to="manage-assets"
                variant="primary"
                width="full"
                className="whitespace-nowrap"
              >
                Add assets
              </Button>
            </When>
          </div>
        </Filters>
        <List
          className=""
          ItemComponent={ListAssetContent}
          extraItemComponentProps={{
            canReadCustody,
            userRoleCanManageAssets,
          }}
          bulkActions={
            userRoleCanManageAssets ? <ListBulkActionsDropdown /> : undefined
          }
          headerChildren={
            <>
              <Th>Category</Th>
              <Th>Tags</Th>
              <Th className="flex items-center gap-1 whitespace-nowrap md:border-b-0">
                Custodian{" "}
                <InfoTooltip
                  iconClassName="size-4"
                  content={
                    <>
                      <h6>Asset custody</h6>
                      <p>
                        This column shows if a user has custody of the asset
                        either via direct assignment or via a booking. If you
                        see <GrayBadge>private</GrayBadge> that means you don't
                        have the permissions to see who has custody of the
                        asset.
                      </p>
                    </>
                  }
                />
              </Th>
              <When truthy={userRoleCanManageAssets}>
                <Th />
              </When>
            </>
          }
          customEmptyStateContent={{
            title: "There are currently no assets at the location",
            text: "Add assets in this location",
            newButtonRoute: "manage-assets",
            newButtonContent: "Add asset",
          }}
        />
      </div>
    </>
  );
}

const ListAssetContent = ({
  item,
  extraProps,
}: {
  item: Asset & {
    category: Pick<Category, "id" | "name" | "color"> | null;
    tags?: Tag[];
    location?: Location;
    /**
     * The pivot row for the current location, included by `getLocation`'s
     * `assetLocations: { where: { locationId: id } }` filter. Always
     * length-1 in this page's data — the row for the location the user
     * is viewing.
     */
    assetLocations: Array<{
      locationId: string;
      quantity: number;
      // Manual-vs-kit-driven discriminator + kit info for the "via kit" badge.
      assetKitId: string | null;
      assetKit: { id: string; kit: { id: string; name: string } } | null;
    }>;
    qrCodes: { id: string }[];
    barcodes: { id: string; type: BarcodeType; value: string }[];
    custody: {
      custodian: {
        id: string;
        name: string;
        user: {
          id: string;
          firstName: string;
          lastName: string;
          profilePicture: string;
          email: string;
        };
      };
    };
  };
  extraProps: { canReadCustody: boolean; userRoleCanManageAssets: boolean };
}) => {
  const { category, tags, custody } = item;
  // The location whose detail page we're on — used to pick this asset's
  // pivot row out of `item.assetLocations`. Mirrors the kit-page
  // `useParams<{ kitId }>` pattern at `kits.$kitId.assets.tsx:179`.
  const { locationId } = useParams<{ locationId: string }>();
  const currentOrganization = useCurrentOrganization();
  const displayCode = currentOrganization
    ? resolveDisplayCode({ entity: item, organization: currentOrganization })
    : null;
  return (
    <>
      <Td className="w-full whitespace-normal p-0 md:p-0">
        <div className="flex justify-between gap-3 p-4  md:justify-normal md:px-6">
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
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block font-medium">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left text-gray-900 hover:text-gray-700"
                  target="_blank"
                  onlyNewTabIconOnHover={true}
                >
                  {item.title}
                </Button>
                {isQuantityTracked(item)
                  ? (() => {
                      /**
                       * Render `· N units at this location` for qty-
                       * tracked rows. `AssetLocation.quantity` is the
                       * source of truth — the picker writes it, the
                       * orthogonal-MAX formula reads it, the DEFERRED
                       * trigger enforces the sum. Surface the
                       * location-specific count only; the asset's total
                       * is irrelevant on the location page. Mirrors
                       * `kits.$kitId.assets.tsx`'s `· N units in kit`.
                       *
                       * An asset can have both a manual row and one
                       * or more kit-driven rows at the same location,
                       * so SUM across all rows for this asset at this
                       * location. Track whether any row is kit-driven
                       * to surface the "via kit" badge inline.
                       */
                      const unit = item.unitOfMeasure || "units";
                      const rowsAtThisLocation = item.assetLocations.filter(
                        (al) => al.locationId === locationId
                      );
                      const atLocation = rowsAtThisLocation.reduce(
                        (sum, al) => sum + (al.quantity ?? 0),
                        0
                      );
                      // An asset can have multiple kit-driven rows at
                      // the same location (one per AssetKit) — see the
                      // schema comment on `AssetLocation.assetKitId`.
                      // Dedup by kit id so the badge pluralises
                      // correctly ("via 2 kits") and the tooltip lists
                      // every kit + its slice.
                      const kitRowsByKitId = new Map<
                        string,
                        { kit: { id: string; name: string }; quantity: number }
                      >();
                      for (const al of rowsAtThisLocation) {
                        const k = al.assetKit?.kit;
                        if (!k) continue;
                        const existing = kitRowsByKitId.get(k.id);
                        kitRowsByKitId.set(k.id, {
                          kit: k,
                          quantity:
                            (existing?.quantity ?? 0) + (al.quantity ?? 0),
                        });
                      }
                      const kitEntries = Array.from(kitRowsByKitId.values());
                      return (
                        <span className="ml-2 inline-flex items-center gap-2 text-xs font-normal text-gray-500">
                          · {atLocation} {unit} at this location
                          {kitEntries.length > 0 ? (
                            <TooltipProvider delayDuration={150}>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    to={
                                      kitEntries.length === 1
                                        ? `/kits/${kitEntries[0].kit.id}`
                                        : "#"
                                    }
                                    role="link"
                                    variant="link"
                                    target={
                                      kitEntries.length === 1
                                        ? "_blank"
                                        : undefined
                                    }
                                    className="shrink-0 cursor-help rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 no-underline hover:bg-blue-100 hover:text-blue-800"
                                    onClick={
                                      kitEntries.length > 1
                                        ? (e) => e.preventDefault()
                                        : undefined
                                    }
                                  >
                                    {kitEntries.length === 1
                                      ? "via kit"
                                      : `via ${kitEntries.length} kits`}
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="max-w-xs">
                                  <p className="text-xs font-semibold text-gray-700">
                                    {kitEntries.length === 1
                                      ? kitEntries[0].kit.name
                                      : "Placed via multiple kits"}
                                  </p>
                                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-gray-500">
                                    {kitEntries.map((e) => (
                                      <li key={e.kit.id}>
                                        {e.kit.name}
                                        {isQuantityTracked(item) ? (
                                          <span className="ml-1 tabular-nums">
                                            ({e.quantity} {unit})
                                          </span>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="mt-1 text-xs text-gray-500">
                                    These units are at this location because the
                                    asset is in {""}
                                    {kitEntries.length === 1
                                      ? "this kit"
                                      : "these kits"}
                                    . Change the kit&apos;s location to move
                                    them.
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : null}
                        </span>
                      );
                    })()
                  : null}
              </span>
              {/*
                Single metadata line: status first (glanceable color cue),
                code chip second. flex-wrap keeps narrow viewports safe.
              */}
              <div className="flex flex-wrap items-center gap-2">
                <AssetStatusBadge
                  id={item.id}
                  status={item.status}
                  availableToBook={item.availableToBook}
                  asset={item}
                />
                {displayCode ? <AssetCodeBadge {...displayCode} /> : null}
              </div>
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <CategoryBadge category={category} />
      </Td>
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>
      {/* Custodian */}
      <When truthy={extraProps.canReadCustody}>
        <Td>
          {custody?.custodian ? (
            <TeamMemberBadge teamMember={custody.custodian} />
          ) : (
            <EmptyTableValue />
          )}
        </Td>
      </When>
      <When truthy={extraProps.userRoleCanManageAssets}>
        <Td>
          <AssetRowActionsDropdown asset={item} />
        </Td>
      </When>
    </>
  );
};
