import {
  data,
  useLoaderData,
  useParams,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { z } from "zod";
import { AssetCodeBadge } from "~/components/assets/asset-code-badge";
import { AssetImage } from "~/components/assets/asset-image";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import AssetRowActionsDropdown from "~/components/kits/asset-row-actions-dropdown";
import type { KitRemovalBookingImpact } from "~/components/kits/booking-removal-notice";
import ContextualModal from "~/components/layout/contextual-modal";
import ContextualSidebar from "~/components/layout/contextual-sidebar";
import type { HeaderData } from "~/components/layout/header/types";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { useCurrentOrganization } from "~/hooks/use-current-organization";
import { useUserRoleHelper } from "~/hooks/user-user-role-helper";
import { getPrimaryLocation, isQuantityTracked } from "~/modules/asset/utils";
import { resolveDisplayCode } from "~/modules/barcode/display";
import {
  getAssetsForKits,
  getBookingImpactForAssetKits,
} from "~/modules/kit/service.server";
import type { ListItemForKitPage } from "~/modules/kit/types";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError } from "~/utils/error";
import { payload, error, getParams } from "~/utils/http.server";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { userHasPermission } from "~/utils/permissions/permission.validator.client";
import { hasPermission } from "~/utils/permissions/permission.validator.server";
import { requirePermission } from "~/utils/roles.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data ? appendToMetaTitle(data.header.title) : "" },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const { userId } = context.getSession();
  const { kitId } = getParams(params, z.object({ kitId: z.string() }));

  try {
    const { organizationId, userOrganizations } = await requirePermission({
      request,
      userId,
      entity: PermissionEntity.kit,
      action: PermissionAction.read,
    });

    const isManageAssetsUrl = request.url.includes("manage-assets");

    /**
     * Run the assets query and a tiny kit-name lookup in parallel so the
     * page can render `${kit.name}'s assets` (matches the sibling overview
     * route's title pattern) without an extra round-trip.
     */
    const [assets, kit] = await Promise.all([
      getAssetsForKits({
        request,
        organizationId,
        kitId,
        ignoreFilters: isManageAssetsUrl,
      }),
      db.kit.findFirst({
        where: { id: kitId, organizationId },
        select: { name: true },
      }),
    ]);

    /**
     * The route only requires `kit`/`read`, which SELF_SERVICE and BASE both
     * have — but neither has `kit`/`update`, the permission the removal itself
     * is gated on (`intent2ActionMap.removeAsset` in the parent route). The
     * reserved-booking warning below names bookings across the WHOLE
     * organization, which those roles otherwise never see, and it describes an
     * action they cannot perform — so it is computed only for callers who can
     * actually remove an asset from the kit.
     *
     * Uses the server-side `hasPermission` (the `userHasPermission` validator
     * has the `.client.` suffix and is stripped from the SSR bundle), passing
     * `roles` explicitly to avoid its DB fallback lookup — same pattern as the
     * asset overview loader's `canEditAsset`.
     */
    const roles = userOrganizations.find(
      (o) => o.organization.id === organizationId
    )?.roles;

    const canUpdateKit = await hasPermission({
      userId,
      organizationId,
      roles,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    /**
     * Which bookings a removal of one of the rows on THIS page would affect —
     * RESERVED ones lose the slice, ONGOING/OVERDUE ones keep it flagged as
     * removed from the kit. The row's Remove dialog names both before
     * confirming. Second narrow fetch over the page's `AssetKit` ids (same
     * pattern as `getKitPickerMeta`), deliberately NOT a widening of the
     * parent route's `bookingAssets` include: that one loads every member of
     * the kit unpaginated, so we'd pay for the whole kit to serve one page.
     *
     * Left `undefined` for callers without kit-update — neither the query nor
     * the booking names happen at all — and the key is then dropped from the
     * payload entirely rather than shipped empty. The Remove dialog those
     * roles never see defaults to no notice.
     *
     * `assetId -> impact of removing it from this kit`.
     */
    let bookingImpactByAssetId:
      | Record<string, KitRemovalBookingImpact>
      | undefined;

    if (canUpdateKit) {
      const assetKitIdsByAssetId = assets.items.flatMap((asset) =>
        asset.assetKits
          .filter((ak) => ak.kitId === kitId)
          .map((ak) => [asset.id, ak.id] as const)
      );
      const impactByAssetKitId = await getBookingImpactForAssetKits({
        assetKitIds: assetKitIdsByAssetId.map(([, assetKitId]) => assetKitId),
        organizationId,
      });
      bookingImpactByAssetId = Object.fromEntries(
        assetKitIdsByAssetId
          .map(
            ([assetId, assetKitId]) =>
              [assetId, impactByAssetKitId[assetKitId]] as const
          )
          // Memberships with no impact at all are dropped, so the dialog's
          // `bookingImpact` prop stays absent rather than arriving empty.
          .filter(
            (entry): entry is readonly [string, KitRemovalBookingImpact] =>
              entry[1] !== undefined
          )
      );
    }

    const header: HeaderData = {
      title: kit ? `${kit.name}'s assets` : "Kit assets",
    };

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    return payload({
      header,
      ...assets,
      ...(bookingImpactByAssetId ? { bookingImpactByAssetId } : {}),
      modelName,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw data(error(reason), { status: reason.status });
  }
}

export default function KitAssets() {
  const { roles } = useUserRoleHelper();

  const userRoleCanManageAssets = userHasPermission({
    roles,
    entity: PermissionEntity.kit,
    action: PermissionAction.manageAssets,
  });

  return (
    <>
      <ContextualSidebar />
      <ContextualModal />

      <div className="flex flex-col md:gap-2">
        <Filters
          className="responsive-filters mb-2 lg:mb-0"
          slots={{
            "right-of-search": (
              <SortBy
                sortingOptions={ASSET_SORTING_OPTIONS}
                defaultSortingBy="createdAt"
              />
            ),
          }}
        >
          <When truthy={userRoleCanManageAssets}>
            <div className="mt-2 flex w-full items-center gap-2 md:mt-0">
              <Button
                icon="scan"
                variant="secondary"
                to="../scan-assets"
                width={"full"}
              >
                Scan
              </Button>
              <Button
                to="manage-assets?status=AVAILABLE"
                variant="primary"
                width="full"
                className="whitespace-nowrap"
              >
                Add assets
              </Button>
            </div>
          </When>
        </Filters>

        <List
          ItemComponent={ListContent}
          customEmptyStateContent={{
            title: "Not assets in kit",
            text: userRoleCanManageAssets
              ? "Start by adding your first asset."
              : "",
            newButtonContent: userRoleCanManageAssets
              ? "Add assets"
              : undefined,
            newButtonRoute: userRoleCanManageAssets
              ? "manage-assets?status=AVAILABLE"
              : undefined,
          }}
          headerChildren={
            <>
              <Th>Category</Th>
              <Th>Location</Th>
              <Th>Tags</Th>
            </>
          }
        />
      </div>
    </>
  );
}

function ListContent({ item }: { item: ListItemForKitPage }) {
  const { category, tags } = item;
  // Bookings this asset is on THROUGH this kit — reserved ones lose their slice
  // when it's removed, checked-out ones keep it flagged as removed from the
  // kit, and the row's Remove dialog names both first. Absent for roles without
  // kit-update permission (the loader omits it), which is why every read below
  // is optional — the dialog then shows no notice.
  const { bookingImpactByAssetId } = useLoaderData<typeof loader>();
  // Render only the single primary-location badge — a qty-tracked asset
  // can sit at multiple locations via AssetLocation.
  const location = getPrimaryLocation(item);

  // `kitId` from the URL — used below to pick this asset's pivot row out
  // of `item.assetKits` (the asset can be in multiple kits since
  // Phase 4a-Polish-2; we only care about THIS kit's slice here).
  const { kitId } = useParams<{ kitId: string }>();

  const { roles } = useUserRoleHelper();
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
                  assetModel: item.assetModel ?? null,
                }}
                alt={`Image of ${item.title}`}
                className="size-full rounded-[4px] border object-cover"
                withPreview
              />
            </div>
            <div className="min-w-[180px]">
              <span className="word-break mb-1 block">
                <Button
                  to={`/assets/${item.id}`}
                  variant="link"
                  className="text-left font-medium text-gray-900 hover:text-gray-700"
                  target={"_blank"}
                  onlyNewTabIconOnHover
                >
                  {item.title}
                </Button>
                {isQuantityTracked(item)
                  ? (() => {
                      /**
                       * Render `· N units in kit` for qty-tracked rows.
                       *
                       * `AssetKit.quantity` is the source of truth — the
                       * picker writes it, the kit-custody inherit helper
                       * reads it, reports read it. Surface the kit-specific
                       * count only; the asset's total is irrelevant on the
                       * kit page (and a user comparing N/M would be confused
                       * if the same qty-tracked asset is split across
                       * multiple kits). The `find()` is defensive — the
                       * asset was fetched via `assetKits: { some: { kitId } }`,
                       * so a missing row shouldn't happen.
                       */
                      const unit = item.unitOfMeasure || "units";
                      const inKit =
                        item.assetKits.find((ak) => ak.kitId === kitId)
                          ?.quantity ?? 0;
                      return (
                        <span className="ml-2 text-xs text-gray-500">
                          · {inKit} {unit} in kit
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
        ) : null}
      </Td>
      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>

      <When
        truthy={userHasPermission({
          roles,
          entity: PermissionEntity.asset,
          action: PermissionAction.manageAssets,
        })}
      >
        <Td className="pr-4 text-right">
          <AssetRowActionsDropdown
            asset={item}
            bookingImpact={bookingImpactByAssetId?.[item.id]}
          />
        </Td>
      </When>
    </>
  );
}
