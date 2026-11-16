/**
 * Manage Model Requests
 *
 * Renders the Models tab on the booking manage-assets and manage-kits
 * dialogs. Lets a user reserve N units of an `AssetModel` for a booking
 * without picking specific assets upfront: concrete `BookingAsset` rows are
 * only created at scan-to-assign time by
 * {@link file://../../modules/booking-model-request/service.server.ts}.
 *
 * The tab reads like the Assets tab beside it: a searchable, paginated table
 * with one row per model, showing the model's image, name, availability in the
 * booking's window and default category. Each row carries its own controls:
 *   - not reserved yet: a quantity input and **Add**;
 *   - reserved and still open: the quantity with **Update**, and **Remove**
 *     while nothing has been assigned to it;
 *   - fully fulfilled: read-only, kept as the record of what was reserved.
 *
 * The first page comes from the dialog's loader. Searching, paging and the
 * "Models with assets / All models" choice load other pages through
 * {@link file://../../routes/api+/bookings.$bookingId.model-tab.ts} with a
 * fetcher, so they never touch the dialog's URL or re-run its loader. Models
 * with no assets are hidden unless "All models" is chosen, and this booking's
 * reserved models lead the list.
 *
 * Every control submits to
 * {@link file://../../routes/api+/bookings.$bookingId.model-requests.ts}.
 * Server-side validation errors are shown inline via
 * {@link getValidationErrors} as a fallback when client-side checks pass but
 * the server still rejects (see the CLAUDE.md form-validation pattern).
 */

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import { CategoryBadge } from "~/components/assets/category-badge";
import Input from "~/components/forms/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/forms/select";
import { ChevronRight } from "~/components/icons/library";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Badge } from "~/components/shared/badge";
import { Button } from "~/components/shared/button";
import { Td, Th, Tr } from "~/components/table";
import { useDisabled } from "~/hooks/use-disabled";
import { UpsertModelRequestSchema } from "~/routes/api+/bookings.$bookingId.model-requests";
import type { loader as modelTabLoader } from "~/routes/api+/bookings.$bookingId.model-tab";
import { BADGE_COLORS } from "~/utils/badge-colors";
import {
  canCancelModelReservation,
  getModelRequestQuantityIssue,
  getReservationCeiling,
  isReservationOverCommitted,
  MODEL_TAB_PAGE_PARAM,
  MODEL_TAB_SEARCH_PARAM,
  MODEL_TAB_SHOW_EMPTY_PARAM,
} from "~/utils/booking-model-requests";
import { getValidationErrors } from "~/utils/http";
import { numberInputWheelGuard } from "~/utils/number-input-wheel-guard";
import { tw } from "~/utils/tw";
import { AvailabilityBadge } from "./availability-label";

/** One AssetModel row of the tab, with pre-computed availability. */
export type ManageModelRequestsModel = {
  /** AssetModel.id */
  id: string;
  /** AssetModel.name */
  name: string;
  /** Public URL of the model's cover image, or null when it has none. */
  image: string | null;
  /** Public URL of the list-size thumbnail generated alongside `image`. */
  thumbnailImage: string | null;
  /** Category new assets of this model start in, when the model sets one. */
  defaultCategory: { id: string; name: string; color: string } | null;
  /**
   * Units of this model the booking holds by name that no custodian holds.
   * They count against the same pool as the reservation.
   */
  namedNotInCustody: number;
  /** Total INDIVIDUAL assets of this model in the org */
  total: number;
  /**
   * Units free over the window with this booking left out of the pool,
   * clamped at zero. See `getReservationCeiling` for what this booking may
   * reserve from it.
   */
  available: number;
  /** Units already reserved on other bookings as concrete `BookingAsset`s */
  reservedConcrete: number;
  /** Units already reserved on other bookings as model-level requests */
  reservedViaRequest: number;
  /** Units currently in custody (deducted from the pool) */
  inCustody: number;
};

/** One existing `BookingModelRequest` row projected for the UI. */
export type ManageModelRequestsRequest = {
  assetModelId: string;
  assetModelName: string;
  /** Original reserved quantity. Never decreases on scan. */
  quantity: number;
  /** Units already materialised into concrete `BookingAsset` rows. */
  fulfilledQuantity: number;
  /**
   * Set when every unit has been materialised (`fulfilledQuantity
   * === quantity`). `null` means still outstanding. Fulfilled rows stay in
   * the DB as an audit trail and render read-only.
   */
  fulfilledAt: string | null;
};

/** One page of the Models tab, as the dialog loader and the tab route send it. */
export type ModelTabPage = {
  /** The page of models, already searched and filtered. */
  assetModels: ManageModelRequestsModel[];
  /** Every model-level reservation on this booking, outstanding + fulfilled. */
  modelRequests: ManageModelRequestsRequest[];
  /** How many models the search and filter leave, across all pages. */
  matchedAssetModels: number;
  /** 1-based page `assetModels` was read from. */
  modelsPage: number;
  /** Page size `assetModels` was read with. */
  modelsPerPage: number;
};

/** Props for {@link ManageModelRequests}. */
export interface ManageModelRequestsProps extends ModelTabPage {
  /** The booking being edited, used to build the API endpoint URLs. */
  bookingId: string;
}

/** What the operator has asked the Models tab to show. */
type ModelTabQuery = {
  /** Trimmed search term; empty for none. */
  search: string;
  /** 1-based page. */
  page: number;
  /** List models with no bookable asset too. */
  showEmpty: boolean;
};

type ModelTabQueryAction =
  | { type: "search"; search: string }
  | { type: "page"; page: number }
  | { type: "showEmpty"; showEmpty: boolean };

/** A new search or filter starts again from the first page. */
function modelTabQueryReducer(
  state: ModelTabQuery,
  action: ModelTabQueryAction
): ModelTabQuery {
  switch (action.type) {
    case "search":
      return { ...state, search: action.search, page: 1 };
    case "page":
      return { ...state, page: action.page };
    case "showEmpty":
      return { ...state, showEmpty: action.showEmpty, page: 1 };
  }
}

/** The query the dialog loader's first page answers. */
const INITIAL_QUERY: ModelTabQuery = { search: "", page: 1, showEmpty: false };

/**
 * The tab route URL for a query, using the same keys `readModelTabParams`
 * reads.
 *
 * @param bookingId - The booking whose Models tab is shown.
 * @param query - What to load.
 * @returns A relative URL for `fetcher.load`.
 */
export function buildModelTabUrl(
  bookingId: string,
  query: ModelTabQuery
): string {
  const params = new URLSearchParams();
  if (query.search) params.set(MODEL_TAB_SEARCH_PARAM, query.search);
  if (query.page > 1) params.set(MODEL_TAB_PAGE_PARAM, String(query.page));
  if (query.showEmpty) params.set(MODEL_TAB_SHOW_EMPTY_PARAM, "true");
  const qs = params.toString();
  return `/api/bookings/${bookingId}/model-tab${qs ? `?${qs}` : ""}`;
}

/**
 * How long to wait after the last keystroke before loading the search. Each
 * load is a server round trip, so typing collapses into one per word.
 */
const MODEL_SEARCH_DEBOUNCE_MS = 400;

/**
 * The Models tab of the booking manage-assets / manage-kits dialogs.
 *
 * Shows the loader's first page until the operator changes the query, then
 * the page the tab route returned for it. A route page that comes back with an
 * error keeps the last good page on screen and says why.
 *
 * @param props - See {@link ManageModelRequestsProps}.
 * @returns The search bar, the models table and its pagination.
 */
export function ManageModelRequests({
  bookingId,
  ...initialPage
}: ManageModelRequestsProps) {
  const [query, dispatch] = useReducer(modelTabQueryReducer, INITIAL_QUERY);
  const pageFetcher = useFetcher<typeof modelTabLoader>({
    key: `booking-model-tab-${bookingId}`,
  });
  const { load } = pageFetcher;

  // The loader's page answers the initial query, so nothing loads until the
  // operator changes it. After that the fetcher's page is revalidated along
  // with the loaders whenever a reservation changes.
  const queryChanged = query !== INITIAL_QUERY;
  useEffect(() => {
    if (!queryChanged) return;
    void load(buildModelTabUrl(bookingId, query));
  }, [bookingId, query, queryChanged, load]);

  const loaded = pageFetcher.data;
  const fetchedPage: ModelTabPage | null =
    queryChanged && loaded && loaded.error == null ? loaded : null;
  const loadError =
    queryChanged && loaded && loaded.error != null
      ? loaded.error.message
      : null;
  // The fetcher only holds its latest response, so a failed load would drop
  // the page on screen. Keep the last good one (set during render, the
  // derived-state pattern) and show that beside the error.
  const [lastGoodPage, setLastGoodPage] = useState<ModelTabPage | null>(null);
  if (fetchedPage && fetchedPage !== lastGoodPage) setLastGoodPage(fetchedPage);
  const page =
    fetchedPage ?? (queryChanged ? lastGoodPage : null) ?? initialPage;

  /** This booking's reservation per model, for the row lookup. */
  const requestByModelId = useMemo(
    () => new Map(page.modelRequests.map((r) => [r.assetModelId, r])),
    [page.modelRequests]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b px-6 py-3 sm:flex-row sm:items-center">
        <ModelSearchField
          onSearch={(search) => dispatch({ type: "search", search })}
          isLoading={pageFetcher.state !== "idle"}
        />
        <ModelsWithAssetsSelect
          showEmpty={query.showEmpty}
          onChange={(showEmpty) => dispatch({ type: "showEmpty", showEmpty })}
        />
      </div>

      {loadError ? (
        <p className="border-b px-6 py-2 text-sm text-error-600" role="alert">
          {loadError}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {page.assetModels.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="font-medium text-gray-900">No models found</p>
            <p className="text-sm text-gray-500">
              {query.search
                ? `No models match "${query.search}". Try a different search.`
                : "There are no models on this page."}
              {query.showEmpty
                ? null
                : ' Models without assets are hidden; choose "All models" to list them.'}
            </p>
          </div>
        ) : (
          <table className="w-full table-auto border-collapse">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th className="whitespace-nowrap">Default category</Th>
                <Th>Reservation</Th>
              </tr>
            </thead>
            <tbody>
              {page.assetModels.map((model) => (
                <ModelRow
                  key={model.id}
                  bookingId={bookingId}
                  model={model}
                  request={requestByModelId.get(model.id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ModelPagination
        matchedAssetModels={page.matchedAssetModels}
        modelsPage={page.modelsPage}
        modelsPerPage={page.modelsPerPage}
        onPage={(next) => dispatch({ type: "page", page: next })}
      />
    </div>
  );
}

/**
 * Search field for the Models tab. Reports the trimmed term after the
 * debounce; the clear button reports an empty one at once.
 */
function ModelSearchField({
  onSearch,
  isLoading,
}: {
  /** Called with the trimmed term once typing pauses. */
  onSearch: (search: string) => void;
  /** True while a page is loading, so the field shows it is busy. */
  isLoading: boolean;
}) {
  const [text, setText] = useState("");
  /** Pending debounce timer, or `null` when nothing is scheduled. */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDebouncePending, setIsDebouncePending] = useState(false);

  // The dialog can close while a debounce is still scheduled.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const cancelPending = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setIsDebouncePending(false);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setText(next);
    cancelPending();
    setIsDebouncePending(true);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setIsDebouncePending(false);
      onSearch(next.trim());
    }, MODEL_SEARCH_DEBOUNCE_MS);
  };

  const clearSearch = () => {
    cancelPending();
    setText("");
    onSearch("");
  };

  // Busy from the first keystroke until the page arrives, so the debounce
  // window never looks like an unresponsive field.
  const isBusy = isDebouncePending || isLoading;

  return (
    <div className="relative flex-1">
      <Input
        type="text"
        name={MODEL_TAB_SEARCH_PARAM}
        label="Search models"
        aria-label="Search models"
        placeholder="Search models"
        value={text}
        hideLabel
        className="w-full"
        inputClassName="pr-9"
        onChange={handleChange}
      />
      {text || isBusy ? (
        <Button
          type="button"
          icon={isBusy ? "spinner" : "x"}
          variant="tertiary"
          disabled={isBusy}
          aria-label="Clear model search"
          title="Clear search"
          className="absolute right-3.5 top-1/2 !w-auto -translate-y-1/2 cursor-pointer border-0 p-0 text-gray-400 hover:text-gray-700"
          onClick={clearSearch}
        />
      ) : null}
    </div>
  );
}

/**
 * Chooses whether the Models tab lists models with no bookable asset. Styled
 * like the Assets tab's availability select: two options, models with assets
 * by default.
 */
function ModelsWithAssetsSelect({
  showEmpty,
  onChange,
}: {
  /** Whether models with no bookable asset are listed. */
  showEmpty: boolean;
  /** Called with the new choice. */
  onChange: (showEmpty: boolean) => void;
}) {
  return (
    <Select
      name={MODEL_TAB_SHOW_EMPTY_PARAM}
      value={showEmpty ? "all" : "with"}
      onValueChange={(next) => onChange(next === "all")}
    >
      <SelectTrigger
        className="text-left text-base text-gray-500 md:mt-0 md:max-w-fit"
        aria-label="Which models to show"
      >
        <SelectValue placeholder="Which models to show" />
      </SelectTrigger>
      <SelectContent
        className="w-full min-w-[250px] p-0"
        position="popper"
        align="end"
        sideOffset={4}
      >
        <div className="max-h-[320px] overflow-auto">
          <SelectItem
            value="with"
            className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
          >
            <span className="mr-4 block text-gray-700">Models with assets</span>
          </SelectItem>
          <SelectItem
            value="all"
            className="rounded-none border-b border-gray-200 px-6 py-4 pr-[5px]"
          >
            <span className="mr-4 block text-gray-700">All models</span>
          </SelectItem>
        </div>
      </SelectContent>
    </Select>
  );
}

/**
 * Count and previous / next paging for the Models tab, styled after the
 * shared list pagination. Paging buttons appear only when there is more than
 * one page.
 */
function ModelPagination({
  matchedAssetModels,
  modelsPage,
  modelsPerPage,
  onPage,
}: {
  matchedAssetModels: number;
  modelsPage: number;
  modelsPerPage: number;
  /** Called with the page to load. */
  onPage: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(matchedAssetModels / modelsPerPage));

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3">
      <p className="text-sm text-gray-500">
        {matchedAssetModels} {matchedAssetModels === 1 ? "model" : "models"}
      </p>
      {totalPages > 1 ? (
        <div className="inline-flex items-center rounded border border-gray-300">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onPage(modelsPage - 1)}
            disabled={modelsPage <= 1}
            className="h-8 w-10 rotate-180 rounded-none border-0 bg-transparent px-3 py-[4px] hover:bg-transparent"
            aria-label="Previous page of models"
          >
            <ChevronRight />
          </Button>
          <span className="whitespace-nowrap border-x border-gray-300 px-2.5 py-[4px] text-[14px] font-medium text-gray-500">
            Page{" "}
            <span className="font-semibold text-gray-700">{modelsPage}</span> of{" "}
            <span className="font-semibold text-gray-700">{totalPages}</span>
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => onPage(modelsPage + 1)}
            disabled={modelsPage >= totalPages}
            className="h-8 w-10 rounded-none border-0 bg-transparent px-3 py-[4px] hover:bg-transparent"
            aria-label="Next page of models"
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One model in the table: image, name and status badges, default category,
 * and the controls that match the model's state on this booking.
 */
function ModelRow({
  bookingId,
  model,
  request,
}: {
  bookingId: string;
  model: ManageModelRequestsModel;
  /** This booking's reservation of the model, when it has one. */
  request?: ManageModelRequestsRequest;
}) {
  const isFulfilled = request?.fulfilledAt != null;

  return (
    <Tr>
      <Td className="w-full min-w-[330px] whitespace-normal p-0 md:p-0">
        <div className="flex items-center gap-3 p-4 md:px-6">
          <div className="flex size-14 shrink-0 items-center justify-center">
            {/* Falls back to the asset placeholder when the model has no image. */}
            <ImageWithPreview
              imageUrl={model.image ?? undefined}
              thumbnailUrl={model.thumbnailImage ?? model.image}
              alt={`Image of ${model.name}`}
              className="size-full rounded-[4px] border object-cover"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-y-1">
            <p className="word-break whitespace-break-spaces font-medium">
              {model.name}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {isFulfilled ? (
                <Badge
                  color={BADGE_COLORS.green.bg}
                  textColor={BADGE_COLORS.green.text}
                  withDot={false}
                >
                  Fulfilled
                </Badge>
              ) : (
                <ModelAvailabilityBadge model={model} request={request} />
              )}
              {request && !isFulfilled ? (
                <Badge
                  color={BADGE_COLORS.blue.bg}
                  textColor={BADGE_COLORS.blue.text}
                  withDot={false}
                >
                  {request.quantity} reserved
                  {request.fulfilledQuantity > 0
                    ? ` · ${request.fulfilledQuantity} assigned`
                    : ""}
                </Badge>
              ) : null}
              {request &&
              !isFulfilled &&
              isReservationOverCommitted(model, {
                quantity: request.quantity,
                fulfilled: request.fulfilledQuantity,
              }) ? (
                <OverReservedBadge model={model} request={request} />
              ) : null}
            </div>
          </div>
        </div>
      </Td>

      <Td>
        <CategoryBadge category={model.defaultCategory} />
      </Td>

      <Td className="max-w-none whitespace-normal">
        {isFulfilled && request ? (
          <span className="text-sm text-gray-500">
            {request.fulfilledQuantity} of {request.quantity} assigned
          </span>
        ) : request ? (
          <ReservationControls
            bookingId={bookingId}
            model={model}
            request={request}
          />
        ) : (
          <AddControls bookingId={bookingId} model={model} />
        )}
      </Td>
    </Tr>
  );
}

/**
 * How many more units of a model this booking can take, amber when none.
 *
 * Measured against {@link getReservationCeiling}, the same bound the server
 * enforces. Before a reservation that reads "3 of 5 available"; once the
 * booking reserves some, they come off the ceiling and the row reads "1 more
 * available". A model with no assets at all says so rather than "0 of 0".
 */
function ModelAvailabilityBadge({
  model,
  request,
}: {
  model: ManageModelRequestsModel;
  /** This booking's reservation of the model, when it has one. */
  request?: ManageModelRequestsRequest;
}) {
  if (model.total === 0) {
    return (
      <Badge
        color={BADGE_COLORS.gray.bg}
        textColor={BADGE_COLORS.gray.text}
        withDot={false}
      >
        No assets yet
      </Badge>
    );
  }
  const ceiling = getReservationCeiling(model, request?.fulfilledQuantity ?? 0);
  const more = Math.max(0, ceiling - (request?.quantity ?? 0));
  const tone = more > 0 ? BADGE_COLORS.green : BADGE_COLORS.amber;
  return (
    <Badge color={tone.bg} textColor={tone.text} withDot={false}>
      {request
        ? `${more} more available`
        : `${more} of ${model.total} available`}
    </Badge>
  );
}

/**
 * Warns that this booking reserves more units than the pool can give it over
 * the window, so the operator reduces or removes the reservation.
 */
function OverReservedBadge({
  model,
  request,
}: {
  model: ManageModelRequestsModel;
  request: ManageModelRequestsRequest;
}) {
  // What this booking's reservation can be. Clamped for display, since a
  // negative unit count is not a sentence.
  const unitsLeft = Math.max(
    0,
    getReservationCeiling(model, request.fulfilledQuantity)
  );
  return (
    <AvailabilityBadge
      badgeText="Over-reserved"
      tooltipTitle="Model over-reserved"
      tooltipContent={`Only ${unitsLeft} unit${
        unitsLeft === 1 ? "" : "s"
      } available for this window. Someone else may have reserved more after you. Reduce the quantity or remove the reservation to resolve.`}
    />
  );
}

/**
 * Reads the message off a fetcher's error response. `payload()` stamps
 * `error: null` onto every success, so the value is tested, not the key.
 */
function getFetcherErrorMessage(data: unknown): string | null {
  if (data && typeof data === "object" && "error" in data) {
    const { error } = data as { error?: { message?: string } | null };
    return error?.message ?? null;
  }
  return null;
}

/** Field-level server errors from a fetcher response, see `getValidationErrors`. */
function getFetcherValidationErrors(data: unknown) {
  return getValidationErrors<typeof UpsertModelRequestSchema>(
    data && typeof data === "object" && "error" in data
      ? (data as { error: Parameters<typeof getValidationErrors>[0] }).error
      : undefined
  );
}

/** Shared look of the quantity inputs, red when the value is refused. */
function quantityInputClassName(hasError: boolean) {
  return tw(
    "h-[38px] w-20 rounded-md border bg-white px-2 text-sm tabular-nums",
    "focus:outline-none focus:ring-1",
    hasError
      ? "border-error-500 focus:border-error-500 focus:ring-error-500"
      : "border-gray-300 focus:border-primary-500 focus:ring-primary-500"
  );
}

/**
 * Quantity + **Add** for a model this booking has not reserved yet. Clamps
 * the quantity to the model's availability client-side; the server's guard
 * stays authoritative.
 */
function AddControls({
  bookingId,
  model,
}: {
  bookingId: string;
  model: ManageModelRequestsModel;
}) {
  // Keyed per model so rows never share loading or error state.
  const fetcher = useFetcher({
    key: `booking-model-request-add-${model.id}`,
  });
  const disabled = useDisabled(fetcher);
  const [quantityInput, setQuantityInput] = useState("1");
  // The quantity last sent. A refusal is about that number, so it stops
  // showing once the operator edits the field.
  const [submittedQuantity, setSubmittedQuantity] = useState<string | null>(
    null
  );
  const { total } = model;
  // Nothing is assigned to a reservation that does not exist yet.
  const available = Math.max(0, getReservationCeiling(model, 0));

  /**
   * The server schema plus the model's ceiling for this booking, so the
   * operator sees the limit before a round trip.
   */
  const clientSchema = useMemo(
    () =>
      UpsertModelRequestSchema.superRefine((data, ctx) => {
        if (data.quantity > available) {
          ctx.addIssue({
            code: "custom",
            path: ["quantity"],
            message: `Only ${available} of ${total} available in this window. Reduce the quantity to continue.`,
          });
        }
      }),
    [available, total]
  );
  const zo = useZorm(`AddModelRequest-${model.id}`, clientSchema);

  const liveParse = clientSchema.safeParse({
    assetModelId: model.id,
    quantity: quantityInput,
  });
  const responseIsCurrent = submittedQuantity === quantityInput;
  const serverErrors = responseIsCurrent
    ? getFetcherValidationErrors(fetcher.data)
    : undefined;
  const genericError = responseIsCurrent
    ? getFetcherErrorMessage(fetcher.data)
    : null;
  // With nothing free the controls are disabled and the availability badge
  // already says so; the live "Only 0 of N" error would only repeat it, in red,
  // before the operator has done anything.
  const noneAvailable = available === 0;
  const quantityError =
    serverErrors?.quantity?.message ||
    zo.errors.quantity()?.message ||
    (!liveParse.success && !noneAvailable
      ? liveParse.error.flatten().fieldErrors.quantity?.[0]
      : undefined);
  const message =
    serverErrors?.assetModelId?.message || genericError || quantityError;

  return (
    <div className="flex flex-col gap-1">
      <fetcher.Form
        ref={zo.ref}
        onSubmit={() => setSubmittedQuantity(quantityInput)}
        method="POST"
        action={`/api/bookings/${bookingId}/model-requests`}
        className="flex items-center gap-2"
      >
        <input type="hidden" name={zo.fields.assetModelId()} value={model.id} />
        <input
          id={`model-request-quantity-${model.id}`}
          type="number"
          {...numberInputWheelGuard}
          name={zo.fields.quantity()}
          min={1}
          max={available || undefined}
          step={1}
          value={quantityInput}
          onChange={(e) => setQuantityInput(e.target.value)}
          className={quantityInputClassName(!!quantityError)}
          aria-label={`Quantity of ${model.name} to reserve`}
          aria-invalid={quantityError ? true : undefined}
          aria-describedby={
            message ? `model-request-message-${model.id}` : undefined
          }
          disabled={disabled || noneAvailable}
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled || noneAvailable || !liveParse.success}
          aria-label={`Reserve ${model.name}`}
        >
          {disabled ? "Adding..." : "Add"}
        </Button>
      </fetcher.Form>
      {message ? (
        <p
          id={`model-request-message-${model.id}`}
          className="text-xs text-error-600"
          role="alert"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Quantity with **Update** and **Remove** for a reservation this booking
 * already holds. The quantity can never go below the units already assigned
 * (the floor), and Remove is offered only while nothing is assigned.
 */
function ReservationControls({
  bookingId,
  model,
  request,
}: {
  bookingId: string;
  model: ManageModelRequestsModel;
  request: ManageModelRequestsRequest;
}) {
  // One fetcher for the inline upsert and one for the DELETE, keyed per model
  // so rows don't share loading state.
  const updateFetcher = useFetcher({
    key: `booking-model-request-update-${request.assetModelId}`,
  });
  const removeFetcher = useFetcher({
    key: `booking-model-request-remove-${request.assetModelId}`,
  });
  const isUpdating = useDisabled(updateFetcher);
  const isRemoving = useDisabled(removeFetcher);
  const disabled = isUpdating || isRemoving;

  // What this booking's reservation may climb to, the same bound the server
  // enforces. Left signed: a negative ceiling is a real state of the pool and
  // `getModelRequestQuantityIssue` clamps it for the message.
  const capacityForThisBooking = getReservationCeiling(
    model,
    request.fulfilledQuantity
  );

  // Inline-edit state, re-synced whenever the loader refreshes the
  // server-authoritative quantity (our own update or a concurrent change).
  const [quantityInput, setQuantityInput] = useState(String(request.quantity));
  // The quantity last sent. A refusal is about that number, so it stops
  // showing once the operator edits the field.
  const [submittedQuantity, setSubmittedQuantity] = useState<string | null>(
    null
  );
  useEffect(() => {
    setQuantityInput(String(request.quantity));
  }, [request.quantity]);

  /** Units already matched to a concrete asset: the lowest legal quantity. */
  const floor = request.fulfilledQuantity;

  /**
   * The server schema plus the bounds `upsertBookingModelRequest` enforces,
   * resolved by the shared helper so client and server agree on which changes
   * the pool may refuse (a reduction is never refused by capacity).
   */
  const clientSchema = useMemo(
    () =>
      UpsertModelRequestSchema.superRefine((data, ctx) => {
        const issue = getModelRequestQuantityIssue(data.quantity, {
          floor,
          capacity: capacityForThisBooking,
          current: request.quantity,
          total: model.total,
        });
        if (issue) {
          ctx.addIssue({ code: "custom", path: ["quantity"], message: issue });
        }
      }),
    [capacityForThisBooking, model.total, floor, request.quantity]
  );
  const zo = useZorm(`EditModelRequest-${request.assetModelId}`, clientSchema);

  const liveParse = clientSchema.safeParse({
    assetModelId: request.assetModelId,
    quantity: quantityInput,
  });
  const isDirty = quantityInput.trim() !== String(request.quantity);

  const updateIsCurrent = submittedQuantity === quantityInput;
  const updateServerErrors = updateIsCurrent
    ? getFetcherValidationErrors(updateFetcher.data)
    : undefined;
  const quantityError =
    updateServerErrors?.quantity?.message ||
    zo.errors.quantity()?.message ||
    (!liveParse.success
      ? liveParse.error.flatten().fieldErrors.quantity?.[0]
      : undefined);
  const message =
    quantityError ||
    (updateIsCurrent ? getFetcherErrorMessage(updateFetcher.data) : null) ||
    getFetcherErrorMessage(removeFetcher.data);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <updateFetcher.Form
          ref={zo.ref}
          onSubmit={() => setSubmittedQuantity(quantityInput)}
          method="POST"
          action={`/api/bookings/${bookingId}/model-requests`}
          className="flex items-center gap-2"
        >
          <input
            type="hidden"
            name={zo.fields.assetModelId()}
            value={request.assetModelId}
          />
          <input
            id={`model-request-quantity-${request.assetModelId}`}
            type="number"
            {...numberInputWheelGuard}
            name={zo.fields.quantity()}
            min={Math.max(1, floor)}
            step={1}
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
            className={quantityInputClassName(!!quantityError)}
            aria-label={`New quantity for ${request.assetModelName}`}
            aria-invalid={quantityError ? true : undefined}
            aria-describedby={
              message
                ? `model-request-message-${request.assetModelId}`
                : undefined
            }
            disabled={disabled}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={disabled || !isDirty || !liveParse.success}
            aria-label={`Update reservation for ${request.assetModelName}`}
          >
            {isUpdating ? "Saving..." : "Update"}
          </Button>
        </updateFetcher.Form>

        {/* Once units are assigned, lowering the quantity to the assigned
            count is the way to release the rest. */}
        {canCancelModelReservation(request) ? (
          <removeFetcher.Form
            method="DELETE"
            action={`/api/bookings/${bookingId}/model-requests`}
          >
            <input
              type="hidden"
              name="assetModelId"
              value={request.assetModelId}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={disabled}
              aria-label={`Remove reservation for ${request.assetModelName}`}
            >
              {isRemoving ? "Removing..." : "Remove"}
            </Button>
          </removeFetcher.Form>
        ) : null}
      </div>
      {message ? (
        <p
          id={`model-request-message-${request.assetModelId}`}
          className="text-xs text-error-600"
          role="alert"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
