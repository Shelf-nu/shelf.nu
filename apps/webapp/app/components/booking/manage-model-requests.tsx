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
 * Search, page and the "Models with assets / All models" choice live in the URL
 * under their own keys ({@link MODEL_TAB_SEARCH_PARAM},
 * {@link MODEL_TAB_PAGE_PARAM}, {@link MODEL_TAB_SHOW_EMPTY_PARAM}) so they
 * never filter the Assets or Kits list, and the loader reads them through
 * `readModelTabParams`. Models with no assets are hidden unless "All models"
 * is chosen, and this booking's reserved models lead the list.
 *
 * Every control submits to
 * {@link file://../../routes/api+/bookings.$bookingId.model-requests.ts}.
 * Server-side validation errors are shown inline via
 * {@link getValidationErrors} as a fallback when client-side checks pass but
 * the server still rejects (see the CLAUDE.md form-validation pattern).
 */

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useNavigation } from "react-router";
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
import { useSearchParams } from "~/hooks/search-params";
import { useDisabled } from "~/hooks/use-disabled";
import { UpsertModelRequestSchema } from "~/routes/api+/bookings.$bookingId.model-requests";
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
import { isSearching } from "~/utils/form";
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

/** Props for {@link ManageModelRequests}. */
export interface ManageModelRequestsProps {
  /** The booking being edited, used to build the API endpoint URL. */
  bookingId: string;
  /** The current page of models, already filtered by the URL search. */
  assetModels: ManageModelRequestsModel[];
  /** Every model-level reservation on this booking, outstanding + fulfilled. */
  modelRequests: ManageModelRequestsRequest[];
  /** How many models match the current search, across all pages. */
  matchedAssetModels: number;
  /** 1-based page `assetModels` was read from. */
  modelsPage: number;
  /** Page size `assetModels` was read with. */
  modelsPerPage: number;
}

/**
 * How long to wait after the last keystroke before pushing the search term
 * into the URL. Each URL change re-runs the dialog's loader, so typing must
 * collapse into one request per word; see `SEARCH_DEBOUNCE_MS` in the shared
 * list search form for the rate-limit reasoning, which applies here as well.
 */
const MODEL_SEARCH_DEBOUNCE_MS = 400;

/**
 * The Models tab of the booking manage-assets / manage-kits dialogs.
 *
 * @param props - See {@link ManageModelRequestsProps}.
 * @returns The search bar, the models table and its pagination.
 */
export function ManageModelRequests({
  bookingId,
  assetModels,
  modelRequests,
  matchedAssetModels,
  modelsPage,
  modelsPerPage,
}: ManageModelRequestsProps) {
  /** This booking's reservation per model, for the row lookup. */
  const requestByModelId = useMemo(
    () => new Map(modelRequests.map((r) => [r.assetModelId, r])),
    [modelRequests]
  );
  const [searchParams] = useSearchParams();
  const search = searchParams.get(MODEL_TAB_SEARCH_PARAM)?.trim() ?? "";
  const showingEmpty = searchParams.get(MODEL_TAB_SHOW_EMPTY_PARAM) === "true";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ModelSearchBar />

      <div className="min-h-0 flex-1 overflow-auto">
        {assetModels.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <p className="font-medium text-gray-900">No models found</p>
            <p className="text-sm text-gray-500">
              {search
                ? `No models match "${search}". Try a different search.`
                : "There are no models on this page."}
              {showingEmpty
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
              {assetModels.map((model) => (
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
        matchedAssetModels={matchedAssetModels}
        modelsPage={modelsPage}
        modelsPerPage={modelsPerPage}
      />
    </div>
  );
}

/**
 * Search field for the Models tab. Writes the debounced term to
 * {@link MODEL_TAB_SEARCH_PARAM}, resets the page, and pins `tab=models` so a
 * reload lands back on this tab.
 */
function ModelSearchBar() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const current = searchParams.get(MODEL_TAB_SEARCH_PARAM) ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  /** Pending debounce timer, or `null` when nothing is scheduled. */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isDebouncePending, setIsDebouncePending] = useState(false);

  // The field is uncontrolled, so a URL change it did not make (Back/Forward)
  // would leave it showing an older term. Sync it while nobody is typing, and
  // compare trimmed values because the URL holds the trimmed term.
  useEffect(() => {
    const el = inputRef.current;
    if (!el || debounceRef.current) return;
    if (el.value.trim() !== current) el.value = current;
  }, [current]);

  // The dialog can close while a debounce is still scheduled.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  /** Writes the term (or clears it) and returns to the first page. */
  const applySearch = useCallback(
    (term: string) => {
      setSearchParams(
        (prev) => {
          if (term) prev.set(MODEL_TAB_SEARCH_PARAM, term);
          else prev.delete(MODEL_TAB_SEARCH_PARAM);
          prev.delete(MODEL_TAB_PAGE_PARAM);
          prev.set("tab", "models");
          return prev;
        },
        { replace: true, preventScrollReset: true }
      );
    },
    [setSearchParams]
  );

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value.trim();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setIsDebouncePending(true);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setIsDebouncePending(false);
      applySearch(term);
    }, MODEL_SEARCH_DEBOUNCE_MS);
  };

  const clearSearch = () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setIsDebouncePending(false);
    if (inputRef.current) inputRef.current.value = "";
    applySearch("");
  };

  // Busy from the first keystroke until the loader settles, so the debounce
  // window never looks like an unresponsive field.
  const isBusy = isDebouncePending || isSearching(navigation);

  return (
    <div className="flex flex-col gap-3 border-b px-6 py-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Input
          type="text"
          name={MODEL_TAB_SEARCH_PARAM}
          label="Search models"
          aria-label="Search models"
          placeholder="Search models"
          defaultValue={current}
          hideLabel
          className="w-full"
          inputClassName="pr-9"
          ref={inputRef}
          onChange={handleChange}
        />
        {current || isBusy ? (
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
      <ModelsWithAssetsSelect />
    </div>
  );
}

/**
 * Chooses whether the Models tab lists models with no bookable asset, through
 * {@link MODEL_TAB_SHOW_EMPTY_PARAM}. Styled like the Assets tab's
 * availability select: two options, models with assets by default.
 */
function ModelsWithAssetsSelect() {
  const [searchParams, setSearchParams] = useSearchParams();
  const value =
    searchParams.get(MODEL_TAB_SHOW_EMPTY_PARAM) === "true" ? "all" : "with";

  const handleChange = (next: string) => {
    setSearchParams(
      (prev) => {
        if (next === "all") prev.set(MODEL_TAB_SHOW_EMPTY_PARAM, "true");
        else prev.delete(MODEL_TAB_SHOW_EMPTY_PARAM);
        prev.delete(MODEL_TAB_PAGE_PARAM);
        prev.set("tab", "models");
        return prev;
      },
      { replace: true, preventScrollReset: true }
    );
  };

  return (
    <Select
      name={MODEL_TAB_SHOW_EMPTY_PARAM}
      value={value}
      onValueChange={handleChange}
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
}: {
  matchedAssetModels: number;
  modelsPage: number;
  modelsPerPage: number;
}) {
  const [, setSearchParams] = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(matchedAssetModels / modelsPerPage));

  const goToPage = (page: number) => {
    setSearchParams(
      (prev) => {
        if (page > 1) prev.set(MODEL_TAB_PAGE_PARAM, String(page));
        else prev.delete(MODEL_TAB_PAGE_PARAM);
        prev.set("tab", "models");
        return prev;
      },
      { preventScrollReset: true }
    );
  };

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
            onClick={() => goToPage(modelsPage - 1)}
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
            onClick={() => goToPage(modelsPage + 1)}
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
  const serverErrors = getFetcherValidationErrors(fetcher.data);
  const genericError = getFetcherErrorMessage(fetcher.data);
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

  const updateServerErrors = getFetcherValidationErrors(updateFetcher.data);
  const quantityError =
    updateServerErrors?.quantity?.message ||
    zo.errors.quantity()?.message ||
    (!liveParse.success
      ? liveParse.error.flatten().fieldErrors.quantity?.[0]
      : undefined);
  const message =
    quantityError ||
    getFetcherErrorMessage(updateFetcher.data) ||
    getFetcherErrorMessage(removeFetcher.data);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <updateFetcher.Form
          ref={zo.ref}
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
