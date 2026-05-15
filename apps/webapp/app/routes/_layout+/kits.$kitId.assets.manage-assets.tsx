import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssetStatus, AssetType, KitStatus } from "@prisma/client";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertCircleIcon } from "lucide-react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  data,
  redirect,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";
import { z } from "zod";
import {
  selectedBulkItemsAtom,
  selectedBulkItemsCountAtom,
  setDisabledBulkItemsAtom,
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
import type { ListItemData } from "~/components/list/list-item";
import { LocationBadge } from "~/components/location/location-badge";
import SelectWithSearchParams from "~/components/select-with-search-params/select-with-search-params";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTrigger,
} from "~/components/shared/modal";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "~/components/shared/tooltip";
import { Td, Th } from "~/components/table";
import When from "~/components/when/when";
import { db } from "~/database/db.server";
import { getPaginatedAndFilterableAssets } from "~/modules/asset/service.server";
import type { AssetsFromViewItem } from "~/modules/asset/types";
import { isQuantityTracked } from "~/modules/asset/utils";
import type { PickerAssetMeta } from "~/modules/kit/picker-meta.server";
import { getKitPickerMeta } from "~/modules/kit/picker-meta.server";
import { updateKitAssets } from "~/modules/kit/service.server";
import { appendToMetaTitle } from "~/utils/append-to-meta-title";
import { makeShelfError, ShelfError } from "~/utils/error";
import { isFormProcessing } from "~/utils/form";
import { payload, error, getParams, parseData } from "~/utils/http.server";
import { isSelectingAllItems } from "~/utils/list";
import {
  PermissionAction,
  PermissionEntity,
} from "~/utils/permissions/permission.data";
import { requirePermission } from "~/utils/roles.server";
import { tw } from "~/utils/tw";

export const meta = () => [{ title: appendToMetaTitle("Manage kit assets") }];

type LoaderData = typeof loader;

const ASSET_KIT_FILTERS = [
  { label: "All assets", value: "ALL" },
  { label: "Not in any kit", value: "NOT_IN_KIT" },
  { label: "In other kits", value: "IN_OTHER_KITS" },
];

/**
 * Zod schema for the route's params (`/kits/:kitId/...`).
 *
 * Pulled out so the loader and action share the same parse and the
 * additionalData on `getParams` stays consistent.
 */
const KitParamsSchema = z.object({ kitId: z.string() });

/**
 * Parses the JSON blob the picker submits under `assetQuantities`.
 *
 * Wire format: a JSON-encoded `Record<assetId, quantity>` written into a
 * single hidden form field. The picker writes one entry per selected
 * QUANTITY_TRACKED row. INDIVIDUAL rows are absent — `updateKitAssets`
 * treats missing entries as "use quantity = 1".
 *
 * Why a `transform` instead of `z.record(z.coerce.number())`:
 *
 *   - We need a single, well-shaped 400 when the field is missing,
 *     non-JSON, an array, a primitive, or contains a non-integer / NaN
 *     / negative value. Hand-rolling lets us surface a `Invalid
 *     quantities payload: <reason>` line per failure mode.
 *
 *   - The `unknown` cast is intentional. JSON.parse returns `any`,
 *     which silently swallows shape bugs further down. Narrowing to
 *     `unknown` and re-checking `typeof === "object"` (also excluding
 *     `null` and arrays — both of which would pass `typeof "object"`)
 *     forces the type system to keep us honest.
 *
 *   - Each entry's value gets coerced through `Number(v)` so a string
 *     "5" still parses (browsers sometimes serialise differently across
 *     form-encoders), but the result must be an integer ≥ 1. The
 *     strict-available cap is enforced downstream in
 *     `updateKitAssets`'s server-side re-validation — this schema only
 *     guards the *shape* of the payload, not the *semantic* ceiling.
 *
 * Default empty-object input keeps the action working for pure-INDIVIDUAL
 * submissions where the picker has nothing to write.
 */
const AssetQuantitiesSchema = z
  .string()
  .optional()
  .default("{}")
  .transform((raw, ctx): Record<string, number> => {
    try {
      const parsed: unknown = JSON.parse(raw);
      // Must be a plain object — `null` and arrays both register as
      // `typeof "object"` in JS, so they need explicit exclusion.
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("expected object");
      }
      const result: Record<string, number> = {};
      for (const [assetId, rawValue] of Object.entries(
        parsed as Record<string, unknown>
      )) {
        // Coerce strings through Number() — different form encoders
        // sometimes round-trip integers as strings.
        const value =
          typeof rawValue === "number" ? rawValue : Number(rawValue);
        if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
          throw new Error(`invalid quantity for ${assetId}`);
        }
        result[assetId] = value;
      }
      return result;
    } catch (e) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid quantities payload: ${
          e instanceof Error ? e.message : "parse error"
        }`,
      });
      return z.NEVER;
    }
  });

/**
 * Zod schema for the action's form body.
 *
 *  - `assetIds`: list of every asset id the picker considers selected
 *    AFTER the user's edits. Includes both newly-added ids and ids that
 *    are already in the kit — `updateKitAssets` diffs against the kit's
 *    current state to derive adds / removes / qty-changes.
 *  - `assetQuantities`: per-row qty for QUANTITY_TRACKED rows; see
 *    `AssetQuantitiesSchema`.
 */
const ManageAssetsActionSchema = z.object({
  assetIds: z.array(z.string()).optional().default([]),
  assetQuantities: AssetQuantitiesSchema,
});

export async function loader({ context, request, params }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, KitParamsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const [
      kit,
      {
        assets,
        totalAssets,
        categories,
        totalCategories,
        tags,
        totalTags,
        locations,
        totalLocations,
        search,
        page,
        totalPages,
        perPage,
      },
    ] = await Promise.all([
      db.kit
        .findFirstOrThrow({
          where: { id: kitId, organizationId },
          select: {
            id: true,
            name: true,
            status: true,
            location: { select: { id: true, name: true } },
            // Pull the current pivot rows for THIS kit, including
            // quantity, so the picker can pre-fill the qty input for
            // qty-tracked rows the user is already managing.
            assetKits: {
              select: {
                asset: { select: { id: true } },
                quantity: true,
              },
            },
          },
        })
        .catch((cause) => {
          throw new ShelfError({
            cause,
            title: "Kit not found!",
            message:
              "The kit you are trying to access does not exists or you do not have permission to asset it.",
            status: 404,
            label: "Kit",
          });
        }),
      getPaginatedAndFilterableAssets({
        request,
        organizationId,
      }),
    ]);

    // Phase 4a-Polish-2: hydrate per-asset picker metadata for the
    // QUANTITY_TRACKED rows on this page. See `getKitPickerMeta` for the
    // strict-available formula and its subtleties.
    const pickerMetaByAssetId = await getKitPickerMeta({
      kitId,
      organizationId,
      assetIds: assets.map((a) => a.id),
    });

    const modelName = {
      singular: "asset",
      plural: "assets",
    };

    const itemsWithPickerMeta = assets.map((a) => ({
      ...a,
      pickerMeta: pickerMetaByAssetId.get(a.id) ?? null,
    }));

    return payload({
      header: {
        title: `Add assets for ${kit.name}`,
        subHeading: "Fill up the kit with the assets of your choice.",
      },
      searchFieldLabel: "Search assets",
      searchFieldTooltip: {
        title: "Search your asset database",
        text: "Search assets based on asset name or description, category, tag, location, custodian name. Simply separate your keywords by a space: 'Laptop lenovo 2020'.",
      },
      showSidebar: true,
      noScroll: true,
      kit,
      items: itemsWithPickerMeta,
      totalItems: totalAssets,
      categories,
      tags,
      search,
      page,
      totalCategories,
      totalTags,
      locations,
      totalLocations,
      totalPages,
      perPage,
      modelName,
    });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    throw data(error(reason), { status: reason.status });
  }
}

export async function action({ context, request, params }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  const { kitId } = getParams(params, KitParamsSchema, {
    additionalData: { userId },
  });

  try {
    const { organizationId } = await requirePermission({
      userId: authSession.userId,
      request,
      entity: PermissionEntity.kit,
      action: PermissionAction.update,
    });

    const { assetIds, assetQuantities } = parseData(
      await request.formData(),
      ManageAssetsActionSchema,
      { additionalData: { userId, organizationId, kitId } }
    );

    await updateKitAssets({
      kitId,
      assetIds,
      assetQuantities,
      userId,
      organizationId,
      request,
    });

    return redirect(`/kits/${kitId}/assets`);
  } catch (cause) {
    const reason = makeShelfError(cause, { userId, kitId });
    return data(error(reason), { status: reason.status });
  }
}

export default function ManageAssetsInKit() {
  const { kit, items, totalItems } = useLoaderData<LoaderData>();
  // why: `.map` returns a new array each render. The effects below depend on
  // these lists, so without memoisation each render fired the effect and
  // re-triggered a render via setSelectedBulkItems → infinite loop.
  const kitAssetsList = useMemo(
    () => kit.assetKits.map((ak) => ak.asset),
    [kit.assetKits]
  );
  const kitAssetIds = useMemo(
    () => kitAssetsList.map((asset) => asset.id),
    [kitAssetsList]
  );
  /**
   * Snapshot of each qty-tracked asset's current AssetKit.quantity in
   * this kit — used to (a) pre-fill the picker qty input on initial
   * render and (b) detect post-edit deltas for the in-custody info-box.
   */
  const initialKitQuantities = useMemo(() => {
    const map: Record<string, number> = {};
    for (const ak of kit.assetKits) {
      map[ak.asset.id] = ak.quantity;
    }
    return map;
  }, [kit.assetKits]);

  const navigation = useNavigation();
  const isSearching = isFormProcessing(navigation.state);

  const formRef = useRef<HTMLFormElement>(null);
  const submit = useSubmit();

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const updateItem = useSetAtom(setSelectedBulkItemAtom);
  const setSelectedBulkItems = useSetAtom(setSelectedBulkItemsAtom);
  const selectedBulkItemsCount = useAtomValue(selectedBulkItemsCountAtom);
  const hasSelectedAllItems = isSelectingAllItems(selectedBulkItems);
  const setDisabledBulkItems = useSetAtom(setDisabledBulkItemsAtom);

  /**
   * Per-asset quantity for QUANTITY_TRACKED rows. Submitted as a hidden
   * JSON field so the action can apply the diff against
   * `initialKitQuantities`. Initialised from the kit's current pivot
   * rows so users see "currently allocated 60" rather than starting
   * from a blank input.
   */
  const [quantities, setQuantities] = useState<Record<string, number>>(() => ({
    ...initialKitQuantities,
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

  /** Compute the set of qty-tracked assets where the user changed qty
   *  for an asset that's still in the kit. Used to surface the
   *  in-custody info-box warning describing the operator-side delta.
   */
  const qtyEditedInExistingKitRows = useMemo(() => {
    const out: { assetId: string; delta: number }[] = [];
    for (const [assetId, oldQty] of Object.entries(initialKitQuantities)) {
      const stillSelected = selectedBulkItems.some((a) => a.id === assetId);
      if (!stillSelected) continue;
      const newQty = quantities[assetId] ?? oldQty;
      if (newQty !== oldQty) out.push({ assetId, delta: newQty - oldQty });
    }
    return out;
  }, [initialKitQuantities, quantities, selectedBulkItems]);

  const kitIsInCustody =
    kit.status === KitStatus.IN_CUSTODY || kit.status === KitStatus.CHECKED_OUT;
  const showInCustodyQtyWarning =
    kitIsInCustody && qtyEditedInExistingKitRows.length > 0;

  /**
   * Set selected items for kit based on the route data.
   *
   * Initialise the shared Jotai atom synchronously during the first
   * render (guarded by a ref) rather than running the setter inside a
   * mount effect — react-doctor's `no-derived-state-effect` flags the
   * useEffect form, and the render-time init avoids the empty-first-
   * frame flicker. Same pattern as the booking manage-assets picker
   * at `bookings.$bookingId.overview.manage-assets.tsx:1156-1160`.
   * `AtomsResetHandler` runs its pathname-change reset during render
   * too, so it executes before this init and doesn't clobber the
   * selection.
   */
  const didInitializeSelectedItemsRef = useRef(false);
  if (!didInitializeSelectedItemsRef.current) {
    didInitializeSelectedItemsRef.current = true;
    setSelectedBulkItems(kitAssetsList);
  }

  /**
   * Set disabled items for kit.
   * QUANTITY_TRACKED assets never block selection — their row-level status
   * flips to IN_CUSTODY / CHECKED_OUT as soon as *any* units are
   * operator-allocated or actively booked, but the kit-assign flow uses
   * Option B math (`buildKitCustodyInheritData`) to allocate only the
   * remaining pool. Same precedent as the manage-assets picker filter in
   * `asset/service.server.ts` and the kit ActionsDropdown guard.
   */
  useEffect(() => {
    const disabledBulkItems = items.reduce<ListItemData[]>((acc, asset) => {
      if (isQuantityTracked(asset)) return acc;
      const isCheckedOut = asset.status === AssetStatus.CHECKED_OUT;
      const isInCustody = asset.status === AssetStatus.IN_CUSTODY;

      if ((isCheckedOut || isInCustody) && !kitAssetIds.includes(asset.id)) {
        acc.push(asset);
      }

      return acc;
    }, []);

    setDisabledBulkItems(disabledBulkItems);
  }, [items, kitAssetIds, setDisabledBulkItems]);

  function handleSubmit() {
    void submit(formRef.current);
  }

  return (
    <div className="flex size-full flex-col overflow-y-hidden">
      <div className=" border-b px-6 md:pb-3">
        <Filters
          className="md:border-0 md:p-0"
          slots={{
            "left-of-search": <StatusFilter statusItems={AssetStatus} />,
            "right-of-search": (
              <div className="flex items-center gap-2">
                <SortBy
                  sortingOptions={ASSET_SORTING_OPTIONS}
                  defaultSortingBy="createdAt"
                />
                <SelectWithSearchParams
                  name="assetKitFilter"
                  items={ASSET_KIT_FILTERS}
                  defaultValue="ALL"
                  placeholder="Filter by kit"
                />
              </div>
            ),
          }}
        ></Filters>
      </div>
      <div className="flex justify-around gap-2 border-b p-3 lg:gap-4">
        <DynamicDropdown
          trigger={
            <div className="flex h-6 cursor-pointer items-center gap-2">
              Categories <ChevronRight className="hidden rotate-90 md:inline" />
            </div>
          }
          model={{ name: "category", queryKey: "name" }}
          label="Filter by category"
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
          label="Filter by tags"
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
          label="Filter by Location"
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
      {/* Body of the modal - this is the scrollable area */}
      <div className="flex-1 overflow-y-auto px-5 md:px-0">
        <List
          ItemComponent={RowComponent}
          navigate={(_assetId, item) => {
            const isParkOfCurrentKit = kitAssetIds.includes(item.id);

            // QUANTITY_TRACKED rows are always clickable — partial
            // allocation doesn't block kit-add (Option B handles it).
            if (!isQuantityTracked(item)) {
              if (
                item.status === AssetStatus.CHECKED_OUT &&
                !isParkOfCurrentKit
              ) {
                return;
              }

              if (
                item.status === AssetStatus.IN_CUSTODY &&
                !isParkOfCurrentKit
              ) {
                return;
              }
            }

            // Track per-row qty for qty-tracked rows so the picker
            // input is pre-populated when the row is toggled on and
            // cleaned up when toggled off. INDIVIDUAL rows skip both
            // (the service treats missing entries as "use 1").
            const isCurrentlySelected = selectedBulkItems.some(
              (a) => a.id === item.id
            );
            if (isCurrentlySelected) {
              removeQuantity(item.id);
            } else if (item.type === AssetType.QUANTITY_TRACKED) {
              const meta = item.pickerMeta;
              const fallbackMax =
                meta?.maxAllowedForThisKit ?? item.quantity ?? 1;
              const initial =
                initialKitQuantities[item.id] ?? Math.max(1, fallbackMax);
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
          className="-mx-5 flex h-full flex-col justify-start border-0"
          bulkActions={<> </>}
          headerChildren={
            <>
              <Th>Kit</Th>
              <Th>Category</Th>
              <Th>Tags</Th>
              <Th>Location</Th>
            </>
          }
          disableSelectAllItems={true}
          extraItemComponentProps={{
            kitAssetIds,
            quantities,
            onQuantityChange: handleQuantityChange,
            initialKitQuantities,
          }}
        />
      </div>
      {/* Footer of the modal - fixed at the bottom */}
      <footer className="item-center mt-auto flex shrink-0 justify-between border-t px-6 py-3">
        <p>
          {hasSelectedAllItems ? totalItems : selectedBulkItemsCount} selected
        </p>

        <div className="flex gap-3">
          <Button variant="secondary" to="..">
            Close
          </Button>
          <Form method="post" ref={formRef}>
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
                rows are absent and the service falls back to qty=1. */}
            <input
              type="hidden"
              name="assetQuantities"
              value={JSON.stringify(quantities)}
            />

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" disabled={isSearching}>
                  Confirm
                </Button>
              </AlertDialogTrigger>

              <AlertDialogContent>
                <div className="flex items-center gap-4">
                  <div className="flex size-12 items-center justify-center rounded-full bg-blue-200/20">
                    <div className="flex size-10 items-center justify-center rounded-full bg-blue-200/50">
                      <AlertCircleIcon className="size-4 text-blue-600" />
                    </div>
                  </div>

                  <h3>Add Assets to kit?</h3>
                </div>

                <div>
                  {kitIsInCustody && (
                    <p className="mb-3">
                      This kit is currently{" "}
                      {kit.status === KitStatus.IN_CUSTODY
                        ? "in custody"
                        : "checked out"}
                      . Any assets you add will automatically inherit the kit's
                      status.
                    </p>
                  )}
                  {/* Qty-edit warning: when the user changed a qty-tracked
                      asset's quantity inside an in-custody kit, both
                      AssetKit.quantity AND the kit-allocated Custody.quantity
                      shift in the same tx. Make sure the user understands
                      the cascade before they confirm. */}
                  {showInCustodyQtyWarning && (
                    <div className="mb-3 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800">
                      <strong>Quantity change notice:</strong> You changed the
                      quantity for{" "}
                      {qtyEditedInExistingKitRows.length === 1
                        ? "1 asset"
                        : `${qtyEditedInExistingKitRows.length} assets`}{" "}
                      already in this kit. The custodian's allocation will be
                      adjusted by the same amount when you confirm.
                    </div>
                  )}
                  {kit.location ? (
                    <p className="mb-3">
                      <strong>Location Update Notice:</strong> Adding assets to
                      this kit will automatically update their location to{" "}
                      <strong>{kit.location.name}</strong>.
                    </p>
                  ) : (
                    <p className="mb-3">
                      <strong>Location Update Notice:</strong> Adding assets to
                      this kit will remove their current location since this kit
                      has no location assigned.
                    </p>
                  )}
                  <p>Are you sure you want to continue?</p>
                </div>

                <AlertDialogFooter>
                  <AlertDialogCancel asChild>
                    <Button type="button" variant="secondary">
                      Cancel
                    </Button>
                  </AlertDialogCancel>

                  <AlertDialogAction asChild>
                    <Button type="button" onClick={handleSubmit}>
                      Continue
                    </Button>
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Form>
        </div>
      </footer>
    </div>
  );
}

const RowComponent = ({
  item,
  extraProps: {
    kitAssetIds,
    quantities,
    onQuantityChange,
    initialKitQuantities,
  },
}: {
  item: AssetsFromViewItem & { pickerMeta?: PickerAssetMeta | null };
  extraProps: {
    kitAssetIds: string[];
    quantities: Record<string, number>;
    onQuantityChange: (assetId: string, quantity: number) => void;
    initialKitQuantities: Record<string, number>;
  };
}) => {
  const { category, tags, location } = item;
  const isQty = isQuantityTracked(item);
  // QUANTITY_TRACKED rows behave as "available" for the picker regardless
  // of row-level status — Option B handles partial allocation on assign.
  const isCheckedOut = !isQty && item.status === AssetStatus.CHECKED_OUT;
  const isInCustody = !isQty && item.status === AssetStatus.IN_CUSTODY;
  const isParkOfCurrentKit = kitAssetIds.includes(item.id);

  const allowCursor =
    (isInCustody || isCheckedOut) && !isParkOfCurrentKit
      ? "cursor-not-allowed"
      : "";

  const selectedBulkItems = useAtomValue(selectedBulkItemsAtom);
  const isSelected = selectedBulkItems.some((a) => a.id === item.id);

  /**
   * Decide whether to render the per-row qty input. Only qty-tracked
   * rows that are currently selected qualify — INDIVIDUAL stays a
   * single-checkbox row, and qty-tracked rows that haven't been ticked
   * yet shouldn't take vertical space for an input the user can't act
   * on. `pickerMeta` is undefined-safe in case the loader missed a row
   * (defensive — the loader fetches all qty-tracked ids on the page).
   */
  const showQtyInput = isQty && isSelected && !!item.pickerMeta;
  const meta = item.pickerMeta;
  const currentValue =
    quantities[item.id] ?? meta?.maxAllowedForThisKit ?? item.quantity ?? 1;
  const max = meta?.maxAllowedForThisKit ?? item.quantity ?? Infinity;
  const initialInThisKit = initialKitQuantities[item.id] ?? 0;
  const otherKits = meta?.inOtherKits ?? [];

  return (
    <>
      {/* Name */}
      <Td className={tw("w-full min-w-[330px] p-0 md:p-0", allowCursor)}>
        <div className="flex items-center justify-between gap-3 p-4 md:pr-6">
          <div className="flex items-center gap-3">
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
            <div className="flex flex-col gap-y-1">
              <p className="word-break whitespace-break-spaces font-medium">
                {item.title}
                {isQuantityTracked(item) && item.quantity != null ? (
                  <span className="ml-2 text-xs font-normal text-gray-500">
                    · {item.quantity} {item.unitOfMeasure || "units"}
                    {/* Surface the strict-available pool when it's
                        smaller than the asset's total — clarifies why
                        the qty input's MAX may be lower than the
                        total. Skipped when meta is missing (defensive)
                        or when max equals the total (no constraint to
                        flag). */}
                    {meta && meta.maxAllowedForThisKit < item.quantity ? (
                      <span className="ml-1 text-warning-700">
                        · {meta.maxAllowedForThisKit} available
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </p>
              {/* "Also in Kit X (N)" indicator. Surfaces multi-kit
                  membership so the user knows their picker MAX is
                  capped by allocations elsewhere. Only renders when
                  the asset is in another kit. */}
              {otherKits.length > 0 && (
                <p className="text-xs text-gray-500">
                  Also in:{" "}
                  {otherKits
                    .map((k) => `${k.kitName} (${k.quantity})`)
                    .join(", ")}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {/*
                   When asset is available, show normal status badge.
                   QUANTITY_TRACKED rows are treated as Available for the
                   picker even when their row-level status is IN_CUSTODY /
                   CHECKED_OUT — the row is selectable and Option B math
                   will assign the remaining pool on save. Render the
                   Available badge with a forced AVAILABLE status so the
                   visual matches the actual selectability.
                */}
                <When
                  truthy={
                    item.status === AssetStatus.AVAILABLE ||
                    isQuantityTracked(item)
                  }
                >
                  <AssetStatusBadge
                    id={item.id}
                    status={
                      isQuantityTracked(item)
                        ? AssetStatus.AVAILABLE
                        : item.status
                    }
                    availableToBook={item.availableToBook}
                    asset={item}
                  />
                </When>

                {/* When asset is in other custody, show special badge */}
                <When truthy={isInCustody}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center rounded-md border border-warning-200 bg-warning-50 px-1.5 py-0.5 text-center text-xs text-warning-700">
                          In custody
                        </div>
                      </TooltipTrigger>

                      <TooltipContent
                        side="top"
                        align="end"
                        className="md:w-80"
                      >
                        <h2 className="mb-1 text-xs font-semibold text-gray-700">
                          Asset is in custody
                        </h2>
                        <div className="text-wrap text-xs font-medium text-gray-500">
                          Asset is currently in custody of a team member. <br />{" "}
                          Make sure the asset has an Available status in order
                          to add it to this kit.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </When>

                {/* Asset is in checked out */}
                <When truthy={isCheckedOut && !isParkOfCurrentKit}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center rounded-md border border-warning-200 bg-warning-50 px-1.5 py-0.5 text-center text-xs text-warning-700">
                          Checked out
                        </div>
                      </TooltipTrigger>

                      <TooltipContent
                        side="top"
                        align="end"
                        className="md:w-80"
                      >
                        <h2 className="mb-1 text-xs font-semibold text-gray-700">
                          Asset is checked out
                        </h2>
                        <div className="text-wrap text-xs font-medium text-gray-500">
                          Asset is currently in checked out via a booking.{" "}
                          <br /> Make sure the asset has an Available status in
                          order to add it to this kit.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </When>
                <When truthy={isCheckedOut && isParkOfCurrentKit}>
                  <TooltipProvider delayDuration={100}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center justify-center rounded-md border border-success-200 bg-success-50 px-1.5 py-0.5 text-center text-xs text-success-700">
                          Part of kit
                        </div>
                      </TooltipTrigger>

                      <TooltipContent
                        side="top"
                        align="end"
                        className="md:w-80"
                      >
                        <h2 className="mb-1 text-xs font-semibold text-gray-700">
                          Asset is already part of this kit
                        </h2>
                        <div className="text-wrap text-xs font-medium text-gray-500">
                          Asset is currently in checked out via a booking and is
                          already part of this kit.
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </When>
              </div>
            </div>
          </div>
          {/* Qty picker for QUANTITY_TRACKED rows. Bounded by the
              strict-available pool (`pickerMeta.maxAllowedForThisKit`).
              `e.stopPropagation()` on the wrapper keeps clicks inside
              the input from toggling the row's selection state. */}
          {showQtyInput ? (
            <div
              className="ml-auto flex shrink-0 flex-col items-end gap-1 pr-2"
              role="presentation"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <label
                  htmlFor={`kit-qty-${item.id}`}
                  className="text-xs text-gray-500"
                >
                  Qty:
                </label>
                <input
                  id={`kit-qty-${item.id}`}
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
              {initialInThisKit > 0 && initialInThisKit !== currentValue ? (
                <span className="text-xs text-warning-700">
                  was {initialInThisKit}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Td>

      {/* Kit */}
      <Td className={allowCursor}>
        {(() => {
          const kitName = item.assetKits?.[0]?.kit?.name;
          if (!kitName) return null;
          return (
            <div className="flex w-max items-center justify-center rounded-full bg-gray-100 px-2 py-1 text-center text-xs font-medium">
              {kitName}
            </div>
          );
        })()}
      </Td>

      {/* Category */}
      <Td className={allowCursor}>
        <CategoryBadge category={category} />
      </Td>

      {/* Tags */}
      <Td className={tw("text-left", allowCursor)}>
        <ListItemTagsColumn tags={tags} />
      </Td>

      {/* Location */}
      <Td className={allowCursor}>
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
    </>
  );
};
