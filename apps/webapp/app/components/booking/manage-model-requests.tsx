/**
 * Manage Model Requests (Phase 3d — Book-by-Model)
 *
 * Renders the Models tab on the booking manage-assets route. Lets a
 * user reserve N units of an `AssetModel` for a booking without
 * picking specific assets upfront — concrete `BookingAsset` rows are
 * only created at scan-to-assign time by
 * {@link file://../../modules/booking-model-request/service.server.ts}.
 *
 * Responsibilities:
 *   1. List existing `BookingModelRequest` rows with a "Remove" button.
 *   2. Offer a searchable picker + quantity input to add a new
 *      reservation for a model that isn't already reserved on this
 *      booking. The picker is {@link DynamicSelect} backed by the
 *      shared `api+/model-filters.ts` endpoint, so orgs with many
 *      models (50+) get proper typeahead instead of a flat `<select>`.
 *   3. Surface availability ("3 / 5 available") inside each picker
 *      option and on the selected-model hint so the user never
 *      over-reserves.
 *
 * Submits to
 * {@link file://../../routes/api+/bookings.$bookingId.model-requests.ts}.
 * Server-side validation errors are surfaced inline via
 * {@link getValidationErrors} as a fallback when client-side checks
 * pass but the server still rejects (see CLAUDE.md form-validation
 * pattern).
 */

import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import type { UpsertModelRequestSchema } from "~/routes/api+/bookings.$bookingId.model-requests";
import { getValidationErrors } from "~/utils/http";
import { tw } from "~/utils/tw";
import { AvailabilityBadge } from "./availability-label";

/** One AssetModel available to the picker, with pre-computed availability. */
export type ManageModelRequestsModel = {
  /** AssetModel.id */
  id: string;
  /** AssetModel.name — used as the label in the picker + lists */
  name: string;
  /** Total INDIVIDUAL assets of this model in the org */
  total: number;
  /** Units the current booking can still reserve from this pool */
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
  quantity: number;
};

/** Props for {@link ManageModelRequests}. */
export interface ManageModelRequestsProps {
  /** The booking being edited — used to build the API endpoint URL. */
  bookingId: string;
  /**
   * Initial page of AssetModels (capped at `MODEL_PICKER_LIMIT` in
   * the loader) with pre-computed availability on each. Used both as
   * the fast lookup for the selected model's availability and as the
   * seed list for `DynamicSelect` — the picker falls through to the
   * shared `api+/model-filters` endpoint for search beyond this seed.
   */
  assetModels: ManageModelRequestsModel[];
  /** Existing model-level reservations on this booking. */
  modelRequests: ManageModelRequestsRequest[];
}

/**
 * Manage the Models tab on the booking manage-assets route.
 *
 * @param props - See {@link ManageModelRequestsProps}.
 * @returns A section containing the existing requests list + the
 *   "Add model reservation" row.
 */
export function ManageModelRequests({
  bookingId,
  assetModels,
  modelRequests,
}: ManageModelRequestsProps) {
  /**
   * Models still available to add (i.e. not already reserved on this
   * booking). Recomputed whenever the loader refreshes `modelRequests`.
   * Passed to {@link DynamicSelect} as `excludeItems` so the picker
   * hides them server-side and via typeahead.
   */
  const reservedModelIds = useMemo(
    () => modelRequests.map((r) => r.assetModelId),
    [modelRequests]
  );

  return (
    <div className="flex flex-col gap-6 overflow-y-auto px-6 py-4">
      <ExistingRequestsList
        bookingId={bookingId}
        assetModels={assetModels}
        modelRequests={modelRequests}
      />

      <AddRequestRow
        bookingId={bookingId}
        assetModels={assetModels}
        excludeModelIds={reservedModelIds}
      />
    </div>
  );
}

/**
 * Renders the already-reserved model rows with "Remove" buttons.
 * Each row shows the model name, the reserved quantity, and — if the
 * post-hoc availability math says we're over-reserved (e.g. someone
 * else reserved concurrently) — an amber {@link AvailabilityBadge}.
 */
function ExistingRequestsList({
  bookingId,
  assetModels,
  modelRequests,
}: {
  bookingId: string;
  assetModels: ManageModelRequestsModel[];
  modelRequests: ManageModelRequestsRequest[];
}) {
  if (modelRequests.length === 0) {
    return (
      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">
          Model reservations
        </h3>
        <p className="text-sm text-gray-500">
          No model-level reservations yet. Use the form below to reserve a
          quantity of a model without picking specific assets.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700">
        Model reservations
      </h3>
      <ul className="flex flex-col divide-y divide-gray-100 rounded-md border border-gray-200">
        {modelRequests.map((req) => {
          // Find the canonical availability row so we can warn when the
          // reservation has drifted out of sync with the pool.
          const model = assetModels.find((m) => m.id === req.assetModelId);
          return (
            <ExistingRequestRow
              key={req.assetModelId}
              bookingId={bookingId}
              request={req}
              model={model}
            />
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Single reserved-row element. The Remove button posts a DELETE to the
 * model-requests API and is disabled while in-flight via `useDisabled`.
 */
function ExistingRequestRow({
  bookingId,
  request,
  model,
}: {
  bookingId: string;
  request: ManageModelRequestsRequest;
  /** Matching loader row — missing when the model was deleted out-of-band. */
  model?: ManageModelRequestsModel;
}) {
  const fetcher = useFetcher({
    key: `booking-model-request-remove-${request.assetModelId}`,
  });
  const disabled = useDisabled(fetcher);

  // The loader-provided `available` already excludes the current
  // booking's reservation, so `available + request.quantity` is the
  // number this booking could still climb to. If `request.quantity`
  // exceeds that we have a shortfall — warn with an amber badge.
  const capacityForThisBooking = model
    ? model.available + request.quantity
    : null;
  const hasShortfall =
    capacityForThisBooking != null && request.quantity > capacityForThisBooking;

  // Surface server-side error from the last delete attempt. Using
  // `getValidationErrors` with the delete schema isn't worth the
  // weight — DELETE errors are typically "booking not in DRAFT state"
  // messages rather than per-field validation.
  const serverError =
    fetcher.data && "error" in fetcher.data && fetcher.data.error != null
      ? (fetcher.data.error as { message?: string }).message ?? null
      : null;

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-gray-900">
          {request.assetModelName}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
          <span>
            {request.quantity} reserved
            {model ? ` · ${model.total} total in workspace` : null}
          </span>
          {hasShortfall ? (
            <AvailabilityBadge
              badgeText="Over-reserved"
              tooltipTitle="Model over-reserved"
              tooltipContent={`Only ${capacityForThisBooking} unit${
                capacityForThisBooking === 1 ? "" : "s"
              } available for this window — someone else may have reserved more after you. Reduce the quantity or remove the reservation to resolve.`}
            />
          ) : null}
        </div>
        {serverError ? (
          <span className="text-xs text-error-600" role="alert">
            {serverError}
          </span>
        ) : null}
      </div>

      <fetcher.Form
        method="DELETE"
        action={`/api/bookings/${bookingId}/model-requests`}
      >
        <input type="hidden" name="assetModelId" value={request.assetModelId} />
        <Button
          type="submit"
          variant="secondary"
          disabled={disabled}
          aria-label={`Remove reservation for ${request.assetModelName}`}
        >
          {disabled ? "Removing..." : "Remove"}
        </Button>
      </fetcher.Form>
    </li>
  );
}

/**
 * The "Add model reservation" row. Uses {@link DynamicSelect} for the
 * model picker so large orgs can type-search through their models,
 * clamps the quantity to the selected model's availability, and POSTs
 * to the model-requests API.
 *
 * Layout: picker + qty input + button on a single row with aligned
 * bottoms. Helper text (availability hint, validation errors) lives
 * in a full-width row below so the form controls themselves stay
 * visually level.
 */
function AddRequestRow({
  bookingId,
  assetModels,
  excludeModelIds,
}: {
  bookingId: string;
  assetModels: ManageModelRequestsModel[];
  excludeModelIds: string[];
}) {
  const fetcher = useFetcher({ key: "booking-model-request-add" });
  const disabled = useDisabled(fetcher);

  const [assetModelId, setAssetModelId] = useState<string | undefined>(
    undefined
  );
  const [quantity, setQuantity] = useState<number>(1);

  /**
   * Selected model's availability, if we have it locally (initial 50).
   * Picks up `undefined` for models fetched via typeahead beyond the
   * loader's seed list — in that case we skip the client-side clamp
   * and let the server's availability guard handle over-reservation.
   */
  const selectedModel = useMemo(
    () => assetModels.find((m) => m.id === assetModelId),
    [assetModelId, assetModels]
  );

  // `getValidationErrors` handles server-side validation errors that
  // slipped past client-side checks (e.g. someone concurrently reserved
  // and dropped our availability to zero). Per CLAUDE.md form-validation
  // pattern.
  const validationErrors = getValidationErrors<typeof UpsertModelRequestSchema>(
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : undefined
  );
  const genericServerError =
    fetcher.data && "error" in fetcher.data && fetcher.data.error != null
      ? (fetcher.data.error as { message?: string }).message ?? null
      : null;

  // Clamp the client-side `max` to the selected model's availability
  // when we have it. Beyond the seed list fall back to a permissive
  // cap — the server is the authoritative guard.
  const maxQuantity = selectedModel?.available ?? 9999;
  const hasAvailability = selectedModel == null || selectedModel.available > 0;
  const pickerHasOptions = assetModels.some(
    (m) => !excludeModelIds.includes(m.id)
  );

  // Render helper text beneath the whole row (availability for the
  // selected model + "pick something first" prompt).
  const selectionHint = selectedModel
    ? `${selectedModel.available} / ${selectedModel.total} available in this window`
    : assetModelId
    ? null // selected but not in seed list — no local hint, server validates
    : "Pick a model to see its availability.";

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700">
        Add model reservation
      </h3>

      <fetcher.Form
        method="POST"
        action={`/api/bookings/${bookingId}/model-requests`}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        {/* Model picker — DynamicSelect searches the shared model-filters
            endpoint so orgs with 50+ models get proper typeahead. The
            `onChange` callback updates our local state so the Qty
            input can clamp its max based on the selected model's
            availability. */}
        <div className="min-w-0 flex-1">
          <DynamicSelect
            fieldName="assetModelId"
            model={{ name: "assetModel", queryKey: "name" }}
            label="Model"
            placeholder="Search models..."
            contentLabel="Asset models"
            initialDataKey="initialAssetModels"
            countKey="totalAssetModels"
            selectionMode="none"
            closeOnSelect
            showSearch
            excludeItems={excludeModelIds}
            defaultValue={assetModelId}
            onChange={(id) => {
              setAssetModelId(id);
              setQuantity(1);
            }}
            disabled={disabled}
            triggerWrapperClassName="flex flex-col !gap-0 justify-start items-start [&_.inner-label]:w-full [&_.inner-label]:text-left"
            // Render each option with availability on the right so the
            // operator can see capacity without leaving the dropdown.
            renderItem={(item) => {
              const meta = item.metadata as
                | Partial<ManageModelRequestsModel>
                | undefined;
              const available = meta?.available;
              const total = meta?.total;
              return (
                <div className="flex w-full items-center justify-between gap-3">
                  <span className="truncate">{item.name}</span>
                  {available != null && total != null ? (
                    <span
                      className={tw(
                        "shrink-0 text-xs tabular-nums",
                        available > 0 ? "text-gray-500" : "text-amber-600"
                      )}
                    >
                      {available} / {total}
                    </span>
                  ) : null}
                </div>
              );
            }}
          />
        </div>

        {/* Quantity — sibling column, same top alignment as the picker. */}
        <div className="w-full sm:w-28">
          <label
            htmlFor="model-request-quantity"
            className="mb-[6px] block text-[14px] font-medium text-gray-700"
          >
            Quantity
          </label>
          <input
            id="model-request-quantity"
            type="number"
            name="quantity"
            min={1}
            max={maxQuantity}
            step={1}
            value={quantity}
            onChange={(e) => {
              const parsed = Number(e.target.value);
              if (Number.isNaN(parsed)) return;
              const clamped = Math.max(1, Math.min(parsed, maxQuantity));
              setQuantity(clamped);
            }}
            className={tw(
              "h-[38px] w-full rounded-md border border-gray-300 bg-white px-3 text-sm",
              "focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            )}
            aria-label="Quantity to reserve"
            disabled={disabled || !assetModelId}
          />
        </div>

        {/* Submit — Add button aligns with the inputs' TOP edge (h-[38px]
            buttons + matching label spacer) so the whole row reads as
            three equal-height columns. */}
        <div className="w-full sm:w-auto">
          {/* Spacer matching label height so the button sits level with
              the two inputs. Only visible on sm+ where labels are inline. */}
          <div
            aria-hidden
            className="mb-[6px] hidden h-[18px] text-[14px] leading-none sm:block"
          />
          <Button
            type="submit"
            variant="primary"
            disabled={disabled || !assetModelId || !hasAvailability}
            aria-label="Add model reservation"
            className="h-[38px] w-full sm:w-auto"
          >
            {disabled ? "Adding..." : "Add"}
          </Button>
        </div>
      </fetcher.Form>

      {/* Full-width helper + error line. Kept below the form so the
          control row stays level regardless of whether a hint is
          shown. */}
      <div className="mt-2 min-h-4 text-xs">
        {validationErrors?.assetModelId?.message ? (
          <p className="text-error-600" role="alert">
            {validationErrors.assetModelId.message}
          </p>
        ) : validationErrors?.quantity?.message ? (
          <p className="text-error-600" role="alert">
            {validationErrors.quantity.message}
          </p>
        ) : genericServerError ? (
          <p className="text-error-600" role="alert">
            {genericServerError}
          </p>
        ) : selectedModel && !hasAvailability ? (
          <p className="text-amber-700">
            No units of{" "}
            <span className="font-semibold">{selectedModel.name}</span> are
            available in this window.
          </p>
        ) : selectionHint ? (
          <p className="text-gray-500">{selectionHint}</p>
        ) : null}
      </div>

      {!pickerHasOptions ? (
        <p className="mt-2 text-xs text-gray-500">
          All available models already have reservations on this booking. Adjust
          an existing reservation above or remove one first.
        </p>
      ) : null}
    </div>
  );
}
