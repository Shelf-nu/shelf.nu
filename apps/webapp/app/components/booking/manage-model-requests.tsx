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
 *   2. Offer a picker + quantity input to add a new reservation for a
 *      model that isn't already reserved on this booking.
 *   3. Surface availability ("3 / 5 available") via
 *      {@link AvailabilityBadge} so the user never over-reserves.
 *
 * Submits to
 * {@link file://../../routes/api+/bookings.$bookingId.model-requests.ts}.
 * Server-side validation errors are surfaced inline via
 * {@link getValidationErrors} as a fallback when client-side checks
 * pass but the server still rejects (see CLAUDE.md form-validation
 * pattern).
 *
 * TODO(3d): the picker is a native `<select>` for simplicity — the
 * plan allows falling back from `DynamicSelect` when the wiring is
 * heavyweight. Revisit once this flow graduates to support searching
 * through 500+ models.
 */

import { useMemo, useState } from "react";
import { useFetcher } from "react-router";
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
  /** All AssetModels the user can pick from, pre-sorted by name asc. */
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
   */
  const reservedModelIds = useMemo(
    () => new Set(modelRequests.map((r) => r.assetModelId)),
    [modelRequests]
  );
  const pickableModels = useMemo(
    () => assetModels.filter((m) => !reservedModelIds.has(m.id)),
    [assetModels, reservedModelIds]
  );

  return (
    <div className="flex flex-col gap-6 overflow-y-auto px-6 py-4">
      <ExistingRequestsList
        bookingId={bookingId}
        assetModels={assetModels}
        modelRequests={modelRequests}
      />

      <AddRequestRow bookingId={bookingId} pickableModels={pickableModels} />
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
 * The "Add model reservation" row. Picks an unreserved model, clamps
 * the quantity to availability, and POSTs to the model-requests API.
 */
function AddRequestRow({
  bookingId,
  pickableModels,
}: {
  bookingId: string;
  pickableModels: ManageModelRequestsModel[];
}) {
  const fetcher = useFetcher({ key: "booking-model-request-add" });
  const disabled = useDisabled(fetcher);

  const [assetModelId, setAssetModelId] = useState<string>(
    pickableModels[0]?.id ?? ""
  );
  const [quantity, setQuantity] = useState<number>(1);

  /** The currently selected model (for availability hints + max clamp). */
  const selectedModel = useMemo(
    () => pickableModels.find((m) => m.id === assetModelId),
    [assetModelId, pickableModels]
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

  // We clamp the client-side `max` to the selected model's availability
  // so the browser's built-in validation is aligned with the server.
  const maxQuantity = selectedModel?.available ?? 1;
  const hasAvailability = (selectedModel?.available ?? 0) > 0;

  if (pickableModels.length === 0) {
    return (
      <div>
        <h3 className="mb-1 text-sm font-semibold text-gray-700">
          Add model reservation
        </h3>
        <p className="text-sm text-gray-500">
          All available models already have reservations on this booking. Adjust
          an existing reservation above or remove one first.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-gray-700">
        Add model reservation
      </h3>
      <fetcher.Form
        method="POST"
        action={`/api/bookings/${bookingId}/model-requests`}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <label
            htmlFor="model-request-picker"
            className="mb-1 block text-xs font-medium text-gray-700"
          >
            Model
          </label>
          <select
            id="model-request-picker"
            name="assetModelId"
            value={assetModelId}
            onChange={(e) => {
              setAssetModelId(e.target.value);
              // Reset qty to 1 when switching models so we never carry
              // a value over the new model's availability.
              setQuantity(1);
            }}
            className={tw(
              "h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm",
              "focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            )}
            aria-describedby="model-request-picker-availability"
          >
            {pickableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} — {m.available} / {m.total} available
              </option>
            ))}
          </select>
          <p
            id="model-request-picker-availability"
            className="mt-1 text-xs text-gray-500"
          >
            {selectedModel
              ? `${selectedModel.available} / ${selectedModel.total} available in this window`
              : null}
          </p>
          {validationErrors?.assetModelId?.message ? (
            <p className="mt-1 text-xs text-error-600" role="alert">
              {validationErrors.assetModelId.message}
            </p>
          ) : null}
        </div>

        <div className="w-full sm:w-32">
          <label
            htmlFor="model-request-quantity"
            className="mb-1 block text-xs font-medium text-gray-700"
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
              "h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm",
              "focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            )}
            aria-label="Quantity to reserve"
          />
          {validationErrors?.quantity?.message ? (
            <p className="mt-1 text-xs text-error-600" role="alert">
              {validationErrors.quantity.message}
            </p>
          ) : null}
        </div>

        <Button
          type="submit"
          variant="primary"
          disabled={disabled || !hasAvailability}
          aria-label="Add model reservation"
        >
          {disabled ? "Adding..." : "Add"}
        </Button>
      </fetcher.Form>

      {genericServerError &&
      !validationErrors?.assetModelId &&
      !validationErrors?.quantity ? (
        <p className="mt-2 text-xs text-error-600" role="alert">
          {genericServerError}
        </p>
      ) : null}

      {selectedModel && !hasAvailability ? (
        <p className="mt-2 text-xs text-amber-700">
          No units of{" "}
          <span className="font-semibold">{selectedModel.name}</span> are
          available in this window.
        </p>
      ) : null}
    </div>
  );
}
