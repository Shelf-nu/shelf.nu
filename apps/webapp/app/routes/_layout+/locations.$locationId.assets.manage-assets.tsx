import { useCallback, useMemo, useRef, useState } from "react";
import { AssetStatus, AssetType, type Prisma } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import type {
  ActionFunctionArgs,
  LoaderFunctionArgs,
  MetaFunction,
} from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setSelectedBulkItemAtom,
  setSelectedBulkItemsAtom,
} from "~/atoms/list";
import { AssetImage } from "~/components/assets/asset-image/component";
import { AssetStatusBadge } from "~/components/assets/asset-status-badge";
import { ASSET_SORTING_OPTIONS } from "~/components/assets/assets-index/filters";
import { ListItemTagsColumn } from "~/components/assets/assets-index/list-item-tags-column";
import { CategoryBadge } from "~/components/assets/category-badge";
import { StatusFilter } from "~/components/booking/status-filter";
import { Form } from "~/components/custom-form";
import DynamicDropdown from "~/components/dynamic-dropdown/dynamic-dropdown";
import { ChevronRight } from "~/components/icons/library";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { List } from "~/components/list";
import { Filters } from "~/components/list/filters";
import { SortBy } from "~/components/list/filters/sort-by";
import { LocationBadge } from "~/components/location/location-badge";
import { Button } from "~/components/shared/button";
import { GrayBadge } from "~/components/shared/gray-badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "~/components/shared/tabs";
import { Td, Th } from "~/components/table";
import UnsavedChangesAlert from "~/components/unsaved-changes-alert";
import { db } from "~/database/db.server";
import type { LOCATION_WITH_HIERARCHY } from "~/modules/asset/fields";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import { getPrimaryLocation, isQuantityTracked } from "~/modules/asset/utils";
import type { PickerAssetMeta } from "~/modules/location/picker-meta.server";
import { getLocationPickerMeta } from "~/modules/location/picker-meta.server";
import { updateLocationAssets } from "~/modules/location/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { AssetQuantitiesSchema } from "~/utils/asset-quantities-schema";
import { ShelfError, makeShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: appendToMetaTitle(data?.header.title) },
];

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    // Location lookup and paginated assets query are independent — run in parallel
    const [location, paginatedAssets] = await Promise.all([
      db.location
        .findUniqueOrThrow({
          where: {
            id: locationId,
            organizationId,
          },
          include: {
            kits: { select: { id: true } },
            // Use `include` (not `select`) at the AssetLocation pivot so
            // Prisma's LocationInclude type narrows through and exposes
            // nested `asset` in the result type. `quantity` powers the
            // picker's qty input pre-fill for already-placed rows.
            assetLocations: {
              include: { asset: { select: { id: true } } },
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            title: "Location not found",
            message:
              "The location you are trying to access does not exist or you do not have permission to access it.",
            additionalData: { locationId, userId, organizationId },
            status: 404,
            label: "Location",
          });
        }),
      getPaginatedAndFilterableAssets({
        request,
        organizationId,
      }),
    ]);

    const {
      search,
      totalAssets,
      perPage,
      page,
      categories,
      tags,
      assets,
      totalPages,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
    } = paginatedAssets;

    /**
     * Hydrate per-asset picker metadata for QUANTITY_TRACKED rows on
     * this page. Drives the qty input's MAX (orthogonal model — see
     * `getLocationPickerMeta`) and the "Also at: …" indicator for
     * multi-placement.
     */
    const pickerMetaByAssetId = await getLocationPickerMeta({
      locationId,
      organizationId,
      assetIds: assets.map((a) => a.id),
    });

    const itemsWithPickerMeta = assets.map((a) => ({
      ...a,
      pickerMeta: pickerMetaByAssetId.get(a.id) ?? null,
    }));

    const modelName = {
      singular: "asset",
      plural: "assets",
    };
    const header = {
      title: `Move assets to ‘${location?.name}’ location`,
      subHeading:
        "Search your database for assets that you would like to move to this location.",
    };

    return payload({
      header,
      showSidebar: true,
      noScroll: true,
      items: itemsWithPickerMeta,
      categories,
      tags,
      search,
      page,
      totalItems: totalAssets,
      perPage,
      totalPages,
      modelName,
      location,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;
  const { locationId } = getParams(
    params,
    z.object({ locationId: z.string() }),
    {
      additionalData: { userId },
    }
  );

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.location,
      action: PermissionAction.update,
    });

    const { assetIds, removedAssetIds, assetQuantities, redirectTo } =
      parseData(
        await request.formData(),
        z.object({
          assetIds: z.array(z.string()).optional().default([]),
          removedAssetIds: z.array(z.string()).optional().default([]),
          assetQuantities: AssetQuantitiesSchema,
          redirectTo: z.string().optional(),
        }),
        {
          additionalData: { userId, organizationId, locationId },
        }
      );

    await updateLocationAssets({
      assetIds,
      organizationId,
      locationId,
      userId,
      request,
      removedAssetIds,
      assetQuantities,
    });

    /**
     * If redirectTo is in form that means user has submitted the form through alert,
     * so we have to redirect to manage-kits url
     */
    if (redirectTo) {
      return redirect(redirectTo);
    }

    return redirect(`/locations/${locationId}/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, locationId });
    return data(error(reason), { status: reason.status });
  }
}

export default function AddAssetsToLocation() {
  const { location, totalItems } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);
  const navigate = useNavigate();
  const submit = useSubmit();

  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);

  const locationKitIds = location.kits.map((k) => k.id);
  // Flatten the AssetLocation pivot rows to the simple `asset[]` shape
  // the component logic expects.
  const locationAssets = useMemo(
    () => location.assetLocations.map((al) => al.asset),
    [location.assetLocations]
  );
  const locationAssetsCount = locationAssets.length;
  const hasUnsavedChanges = selectedBulkItemsCount !== locationAssetsCount;

  const manageKitsUrl = `/locations/${location.id}/kits/manage-kits`;

  /**
   * Snapshot of each qty-tracked asset's current AssetLocation.quantity
   * at this location — used to (a) pre-fill the picker qty input on
   * initial render and (b) let the qty-edit branch detect submitted-vs-
   * existing deltas inside `updateLocationAssets`.
   */
  const initialLocationQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const al of location.assetLocations) {
      map[al.asset.id] = al.quantity;
    }
    return map;
  }, [location.assetLocations]);

  const removedAssets = useMemo(
    () =>
      locationAssets.filter(
        (asset) =>
          !selectedBulkItems.some(
            (selectedItem) => selectedItem.id === asset.id
          )
      ),
    [locationAssets, selectedBulkItems]
  );

  /**
   * Per-asset quantity for QUANTITY_TRACKED rows. Submitted as a hidden
   * JSON field so the action can apply the diff against
   * `initialLocationQuantities`. Initialised from the location's
   * current pivot rows so users see "currently 30 at this location"
   * rather than starting from a blank input.
   */
  const [quantities, setQuantities] = useState<Record<string, number>>(() => ({
    ...initialLocationQuantities,
  }));

  const handleQuantityChange = useCallback(
    (assetId: string, quantity: number) => {
      setQuantities((prev) => ({ ...prev, [assetId]: quantity }));
    },
    []
  );

  /** Drop the qty entry when the row is deselected. */
  const removeQuantity = useCallback((assetId: string) => {
    setQuantities((prev) => {
      if (!(assetId in prev)) return prev;
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
  }, []);

  /**
   * Initialise the shared Jotai atom synchronously during the first
   * render (guarded by a ref) rather than running the setter inside a
   * mount effect — react-doctor's `no-derived-state-effect` flags the
   * useEffect form, and the render-time init avoids the empty-first-
   * frame flicker. Mirrors the kit picker at
   * `kits.$kitId.assets.manage-assets.tsx:365-369`.
   */
  const didInitializeSelectedItemsRef = useRef(false);
  if (!didInitializeSelectedItemsRef.current) {
    didInitializeSelectedItemsRef.current = true;
    setSelectedBulkItems(locationAssets);
  }

  return (
    <Tabs
      className="flex h-full max-h-full flex-col"
      value="assets"
      onValueChange={() => {
        if (hasUnsavedChanges) {
          setIsAlertOpen(true);
          return;
        }

        void navigate(manageKitsUrl);
      }}
    >
      <div className="border-b px-6 py-2">
        <TabsList className="w-full">
          <TabsTrigger className="flex-1 gap-x-2" value="assets">
            Assets{" "}
            {selectedBulkItemsCount > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {hasSelectedAllItems ? totalItems : selectedBulkItemsCount}
              </GrayBadge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger className="flex-1 gap-x-2" value="kits">
            Kits
            {locationKitIds.length > 0 ? (
              <GrayBadge className="size-[20px] border border-primary-200 bg-primary-50 text-[10px] leading-[10px] text-primary-700">
                {locationKitIds.length}
              </GrayBadge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </div>

      <Filters
        className="justify-between !border-t-0 border-b px-6 md:flex"
        slots={{
          "left-of-search": <StatusFilter statusItems={AssetStatus} />,
          "right-of-search": (
            <SortBy
              sortingOptions={ASSET_SORTING_OPTIONS}
              defaultSortingBy="createdAt"
            />
          ),
        }}
      />

      <div className=" flex justify-around gap-2 border-b p-3 lg:gap-4">
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Categories <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "category", queryKey: "name" }}
          label="Filter by category"
          placeholder="Search categories"
          initialDataKey="categories"
          countKey="totalCategories"
        />
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Tags <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "tag", queryKey: "name" }}
          label="Filter by tag"
          initialDataKey="tags"
          countKey="totalTags"
        />
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Locations <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "location", queryKey: "name" }}
          label="Filter by location"
          initialDataKey="locations"
          countKey="totalLocations"
          renderItem={({ metadata }) => (
            <div className="flex items-center gap-2">
              <ImageWithPreview
                thumbnailUrl={metadata.thumbnailUrl}
                alt={metadata.name}
                className="size-6 rounded-[2px]"
              />
              <div>{metadata.name}</div>
            </div>
          )}
        />
      </div>

      <TabsContent value="assets" asChild>
        <List
          ItemComponent={RowComponent}
          /** Clicking on the row will add the current asset to the atom of selected assets */
          navigate={(_assetId, item) => {
            // Pre-fill (or clear) the qty input alongside the selection
            // toggle. Mirrors the kit picker's qty-on-toggle behaviour:
            // INDIVIDUAL rows skip both branches (no qty input renders).
            const isCurrentlySelected = selectedBulkItems.some(
              (a) => a.id === item.id
            );
            if (isCurrentlySelected) {
              removeQuantity(item.id);
            } else if (item.type === AssetType.QUANTITY_TRACKED) {
              const meta = (
                item as typeof item & { pickerMeta?: PickerAssetMeta | null }
              ).pickerMeta;
              const fallbackMax =
                meta?.maxAllowedForThisLocation ?? item.quantity ?? 1;
              const initial =
                initialLocationQuantities[item.id] ?? Math.max(1, fallbackMax);
              handleQuantityChange(item.id, initial);
            }
            updateItem(item);
          }}
          customEmptyStateContent={{
            title: "You haven't added any assets yet.",
            text: "What are you waiting for? Create your first asset now!",
            newButtonRoute: "/assets/new",
            newButtonContent: "New asset",
          }}
          className="mx-1 flex h-full flex-col justify-start border-0"
          bulkActions={<> </>}
          headerChildren={
            <>
              <Th>Location</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
            </>
          }
          extraItemComponentProps={{
            quantities,
            onQuantityChange: handleQuantityChange,
            initialLocationQuantities,
          }}
        />
      </TabsContent>

      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <p>
          {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" to={".."}>
            Close
          </Button>
          <Form method="post" ref={formRef}>
            {/* We create inputs for both the removed and selected assets, so we can compare and easily add/remove */}
            {removedAssets.map((asset, i) => (
              <input
                key={asset.id}
                type="hidden"
                name={`removedAssetIds[${i}]`}
                value={asset.id}
              />
            ))}
            {/* These are the ids selected by the user and stored in the atom */}
            {selectedBulkItems.map((asset, i) => (
              <input
                key={asset.id}
                type="hidden"
                name={`assetIds[${i}]`}
                value={asset.id}
              />
            ))}
            {/* JSON-encoded `Record<assetId, quantity>` — picker writes
                one entry per selected QUANTITY_TRACKED asset. INDIVIDUAL
                rows are absent and the service falls back to
                Asset.quantity (legacy default). */}
            <input
              type="hidden"
              name="assetQuantities"
              value={JSON.stringify(quantities)}
            />
            {hasUnsavedChanges && isAlertOpen ? (
              <input name="redirectTo" value={manageKitsUrl} type="hidden" />
            ) : null}
            <Button
              type="submit"
              name="intent"
              value="addAssets"
              disabled={isSearching}
            >
              Confirm
            </Button>
          </Form>
        </div>
      </footer>

      <UnsavedChangesAlert
        open={isAlertOpen}
        onOpenChange={setIsAlertOpen}
        onCancel={() => {
          void navigate(manageKitsUrl);
        }}
        onYes={() => {
          void submit(formRef.current);
        }}
      >
        You have added some assets to the booking but haven't saved it yet. Do
        you want to confirm adding those assets?
      </UnsavedChangesAlert>
    </Tabs>
  );
}

type LocationRowItem = Prisma.AssetGetPayload<{
  include: {
    assetLocations: {
      select: { location: typeof LOCATION_WITH_HIERARCHY };
    };
    category: true;
    tags: true;
  };
}> & {
  /** Attached by the loader. Null for INDIVIDUAL rows or when the
   * helper skipped the asset (defensive — the loader always covers
   * every qty-tracked id on the page). */
  pickerMeta?: PickerAssetMeta | null;
};

const RowComponent = ({
  item,
  extraProps: { quantities, onQuantityChange, initialLocationQuantities },
}: {
  item: LocationRowItem;
  extraProps: {
    quantities: Record<string, number>;
    onQuantityChange: (assetId: string, quantity: number) => void;
    initialLocationQuantities: Record<string, number>;
  };
}) => {
  const { tags, category } = item;
  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const isSelected = selectedBulkItems.some((a) => a.id === item.id);
  const isQty = isQuantityTracked(item);
  const meta = item.pickerMeta;

  /**
   * Decide whether to render the per-row qty input. Only qty-tracked
   * rows that are currently selected qualify — INDIVIDUAL stays a
   * single-checkbox row, and qty-tracked rows that haven't been
   * toggled on shouldn't take vertical space for an input the user
   * can't act on. `pickerMeta` is undefined-safe in case the loader
   * missed a row (defensive — the loader covers every qty-tracked id
   * on the page).
   */
  const showQtyInput = isQty && isSelected && !!meta;
  const currentValue =
    quantities[item.id] ??
    meta?.maxAllowedForThisLocation ??
    item.quantity ??
    1;
  const max =
    meta?.maxAllowedForThisLocation ??
    item.quantity ??
    Number.POSITIVE_INFINITY;
  const initialAtThisLocation = initialLocationQuantities[item.id] ?? 0;
  const otherLocations = meta?.inOtherLocations ?? [];

  return (
    <>
      {/* Name */}
      <Td className="w-full min-w-[330px] p-0 md:p-0">
        <div className="flex items-center justify-between gap-3 p-4 md:pr-6">
          {/* `min-w-0 flex-1` on the title block so its long text
              (e.g. the multi-placement "Also at: ..." line) wraps
              cleanly instead of forcing the qty input off-screen.
              The qty input keeps its `shrink-0` and stays visible. */}
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center">
              <AssetImage
                asset={{
                  id: item.id,
                  mainImage: item.mainImage,
                  thumbnailImage: item.thumbnailImage,
                  mainImageExpiration: item.mainImageExpiration,
                }}
                alt={`Image of ${item.title}`}
                className="size-full rounded-[4px] border object-cover"
              />
            </div>
            {/* Inner text column also gets `min-w-0` so its <p>
                elements wrap instead of expanding the parent. */}
            <div className="flex min-w-0 flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
                {isQuantityTracked(item) && item.quantity != null ? (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    · {item.quantity} {item.unitOfMeasure || "units"}
                    {/* Surface the strict-available pool when it's
                        smaller than the asset's total — clarifies why
                        the qty input's MAX may be lower than the
                        total. Skipped when meta is missing
                        (defensive) or when max equals the total (no
                        constraint to flag). */}
                    {meta && meta.maxAllowedForThisLocation < item.quantity ? (
                      <span className="ml-1 text-warning-700">
                        · {meta.maxAllowedForThisLocation} available
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </p>
              {/* "Also at: Loc X (N)" indicator. Surfaces multi-
                  placement so the user knows their picker MAX is
                  capped by allocations elsewhere. Only renders when
                  the asset is placed at another location. */}
              {otherLocations.length > 0 && (
                // Single-line + ellipsis so a multi-placement list
                // doesn't overflow the Td and visually collide with
                // the qty input on the right. The full list is
                // available via the tooltip below and on the asset
                // overview's "Placed at locations" card.
                <p
                  className="truncate text-xs text-gray-500"
                  title={otherLocations
                    .map((l) => `${l.locationName} (${l.quantity})`)
                    .join(", ")}
                >
                  Also at:{" "}
                  {otherLocations
                    .map((l) => `${l.locationName} (${l.quantity})`)
                    .join(", ")}
                </p>
              )}
              <AssetStatusBadge
                id={item.id}
                status={item.status}
                availableToBook={item.availableToBook}
                asset={item}
              />
            </div>
          </div>
          {/* Qty picker for QUANTITY_TRACKED rows. Bounded by the
              strict-available pool (orthogonal MAX from
              `getLocationPickerMeta`). `e.stopPropagation()` on the
              wrapper keeps clicks inside the input from toggling the
              row's selection state. */}
          {showQtyInput ? (
            <div
              className="ml-auto flex shrink-0 flex-col items-end gap-1 pr-2"
              role="presentation"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <label
                  htmlFor={`location-qty-${item.id}`}
                  className="text-xs text-gray-500"
                >
                  Qty:
                </label>
                <input
                  id={`location-qty-${item.id}`}
                  type="number"
                  min={1}
                  max={Number.isFinite(max) ? max : undefined}
                  value={currentValue}
                  onChange={(e) => {
                    const raw = Number(e.target.value);
                    if (!Number.isFinite(raw)) return;
                    const capped = Math.max(
                      1,
                      Math.min(
                        Math.floor(raw),
                        Number.isFinite(max) ? max : raw
                      )
                    );
                    onQuantityChange(item.id, capped);
                  }}
                  className="h-8 w-16 rounded-md border border-gray-300 px-2 text-center text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  aria-label={`Quantity for ${item.title}`}
                />
                <span className="text-xs text-gray-400">/ {max}</span>
              </div>
              {initialAtThisLocation > 0 &&
              initialAtThisLocation !== currentValue ? (
                <span className="text-xs text-warning-700">
                  was {initialAtThisLocation}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Td>

      {/* Location — primary placement via the AssetLocation pivot. */}
      <Td>
        {(() => {
          const primary = getPrimaryLocation(item);
          if (!primary) return null;
          return (
            <LocationBadge
              location={{
                id: primary.id,
                name: primary.name,
                parentId: primary.parentId ?? undefined,
                childCount: primary._count?.children ?? 0,
              }}
            />
          );
        })()}
      </Td>

      {/* Category */}
      <Td>
        <CategoryBadge category={category} />
      </Td>

      {/* Tags */}
      <Td className="text-left">
        <ListItemTagsColumn tags={tags} />
      </Td>
    </>
  );
};
