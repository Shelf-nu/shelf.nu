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

import { useEffect, useMemo, useState } from "react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import DynamicSelect from "~/components/dynamic-select/dynamic-select";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { UpsertModelRequestSchema } from "~/routes/api+/bookings.$bookingId.model-requests";
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
  // Two fetchers per row — one for the inline upsert (Update button)
  // and one for the DELETE (Remove button). Keyed per-request so
  // multiple rows don't share loading state.
  const updateFetcher = useFetcher({
    key: `booking-model-request-update-${request.assetModelId}`,
  });
  const removeFetcher = useFetcher({
    key: `booking-model-request-remove-${request.assetModelId}`,
  });
  const isUpdating = useDisabled(updateFetcher);
  const isRemoving = useDisabled(removeFetcher);
  const disabled = isUpdating || isRemoving;

  // The loader-provided `available` already excludes the current
  // booking's reservation, so `available + request.quantity` is the
  // number this booking could still climb to. If `request.quantity`
  // exceeds that we have a shortfall — warn with an amber badge.
  const capacityForThisBooking = model
    ? model.available + request.quantity
    : null;
  const hasShortfall =
    capacityForThisBooking != null && request.quantity > capacityForThisBooking;

  // Inline-edit state for the quantity. Resets whenever the loader
  // refreshes the server-authoritative `request.quantity` (e.g. after
  // our own update, or after a concurrent change).
  const [quantityInput, setQuantityInput] = useState<string>(
    String(request.quantity)
  );
  useEffect(() => {
    setQuantityInput(String(request.quantity));
  }, [request.quantity]);

  /**
   * Client schema for the inline update — same shape as the server
   * schema, with a superRefine that enforces "can't exceed the cap
   * this booking is allowed to climb to". We fall back to the bare
   * server schema when loader-side availability is missing (model
   * fetched via typeahead beyond the seed list) and let the server
   * be the authority.
   */
  const clientSchema = useMemo(() => {
    if (capacityForThisBooking == null || model == null) {
      return UpsertModelRequestSchema;
    }
    const max = capacityForThisBooking;
    const total = model.total;
    return UpsertModelRequestSchema.superRefine((data, ctx) => {
      if (data.quantity > max) {
        ctx.addIssue({
          code: "custom",
          path: ["quantity"],
          message: `Only ${max} of ${total} available in this window — reduce the quantity to continue.`,
        });
      }
    });
  }, [capacityForThisBooking, model]);

  const zo = useZorm(`EditModelRequest-${request.assetModelId}`, clientSchema);

  const liveParse = useMemo(
    () =>
      clientSchema.safeParse({
        assetModelId: request.assetModelId,
        quantity: quantityInput,
      }),
    [clientSchema, request.assetModelId, quantityInput]
  );
  const isValid = liveParse.success;
  const liveFieldErrors = !liveParse.success
    ? liveParse.error.flatten().fieldErrors
    : undefined;
  const isDirty = quantityInput.trim() !== String(request.quantity);

  const updateServerErrors = getValidationErrors<
    typeof UpsertModelRequestSchema
  >(
    updateFetcher.data && "error" in updateFetcher.data
      ? updateFetcher.data.error
      : undefined
  );
  const updateGenericError =
    updateFetcher.data &&
    "error" in updateFetcher.data &&
    updateFetcher.data.error != null
      ? (updateFetcher.data.error as { message?: string }).message ?? null
      : null;
  const removeGenericError =
    removeFetcher.data &&
    "error" in removeFetcher.data &&
    removeFetcher.data.error != null
      ? (removeFetcher.data.error as { message?: string }).message ?? null
      : null;

  const quantityError =
    updateServerErrors?.quantity?.message ||
    zo.errors.quantity()?.message ||
    liveFieldErrors?.quantity?.[0];

  return (
    <li className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium text-gray-900">
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
        </div>

        <div className="flex items-center gap-2">
          {/* Inline upsert form — same endpoint as the Add row, just
              pre-filled with this row's assetModelId. Enables the
              "edit existing reservation" flow per TESTING-PHASE-3D §4. */}
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
            <label
              htmlFor={`model-request-quantity-${request.assetModelId}`}
              className="sr-only"
            >
              Quantity for {request.assetModelName}
            </label>
            <input
              id={`model-request-quantity-${request.assetModelId}`}
              type="number"
              name={zo.fields.quantity()}
              min={1}
              step={1}
              value={quantityInput}
              onChange={(e) => setQuantityInput(e.target.value)}
              className={tw(
                "h-[34px] w-20 rounded-md border bg-white px-2 text-sm tabular-nums",
                "focus:outline-none focus:ring-1",
                quantityError
                  ? "border-error-500 focus:border-error-500 focus:ring-error-500"
                  : "border-gray-300 focus:border-primary-500 focus:ring-primary-500"
              )}
              aria-label={`New quantity for ${request.assetModelName}`}
              aria-invalid={quantityError ? true : undefined}
              disabled={disabled}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={disabled || !isDirty || !isValid}
              aria-label={`Update reservation for ${request.assetModelName}`}
            >
              {isUpdating ? "Saving..." : "Update"}
            </Button>
          </updateFetcher.Form>

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
        </div>
      </div>

      {quantityError ? (
        <p className="text-xs text-error-600" role="alert">
          {quantityError}
        </p>
      ) : updateGenericError ? (
        <p className="text-xs text-error-600" role="alert">
          {updateGenericError}
        </p>
      ) : removeGenericError ? (
        <p className="text-xs text-error-600" role="alert">
          {removeGenericError}
        </p>
      ) : null}
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
  // Controlled so we can imperatively reset on successful submit + on
  // model change without fighting the browser's number input.
  const [quantityInput, setQuantityInput] = useState<string>("1");

  /**
   * Selected model's availability, if we have it locally (initial 50).
   * Picks up `undefined` for models fetched via typeahead beyond the
   * loader's seed list — in that case we rely on the server's
   * availability guard to reject over-reservation.
   */
  const selectedModel = useMemo(
    () => assetModels.find((m) => m.id === assetModelId),
    [assetModelId, assetModels]
  );

  /**
   * Client-side schema: same contract as the server's
   * `UpsertModelRequestSchema`, plus a `superRefine` that enforces the
   * selected model's availability so users get inline feedback without
   * a server round-trip. The server schema remains authoritative — this
   * is strictly a UX layer. Rebuilt whenever the selected model (and
   * therefore its availability) changes.
   */
  const clientSchema = useMemo(() => {
    if (!selectedModel) return UpsertModelRequestSchema;
    const { available, total } = selectedModel;
    return UpsertModelRequestSchema.superRefine((data, ctx) => {
      if (data.quantity > available) {
        ctx.addIssue({
          code: "custom",
          path: ["quantity"],
          message: `Only ${available} of ${total} available in this window — reduce the quantity to continue.`,
        });
      }
    });
  }, [selectedModel]);

  const zo = useZorm("AddModelRequest", clientSchema);

  /**
   * Live parse of the current form state. Drives the Add button's
   * `disabled` attribute so users can't submit invalid data in the
   * first place. `z.coerce.number()` accepts the input string directly.
   */
  const liveParse = useMemo(
    () =>
      clientSchema.safeParse({
        assetModelId: assetModelId ?? "",
        quantity: quantityInput,
      }),
    [clientSchema, assetModelId, quantityInput]
  );
  const isValid = liveParse.success;
  const liveFieldErrors = !liveParse.success
    ? liveParse.error.flatten().fieldErrors
    : undefined;

  // After a successful Add, wipe the local picker + quantity. Without
  // this the just-reserved model is still "selected" in the UI even
  // though the loader has already moved it into the excluded list.
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    const hasError = "error" in fetcher.data && fetcher.data.error != null;
    if (hasError) return;
    setAssetModelId(undefined);
    setQuantityInput("1");
  }, [fetcher.state, fetcher.data]);

  // Server-side errors take precedence over live client errors — a
  // concurrent reservation may have dropped availability after the user
  // typed. Per CLAUDE.md form-validation pattern.
  const serverValidationErrors = getValidationErrors<
    typeof UpsertModelRequestSchema
  >(fetcher.data && "error" in fetcher.data ? fetcher.data.error : undefined);
  const genericServerError =
    fetcher.data && "error" in fetcher.data && fetcher.data.error != null
      ? (fetcher.data.error as { message?: string }).message ?? null
      : null;

  const hasAvailability = selectedModel == null || selectedModel.available > 0;
  const pickerHasOptions = assetModels.some(
    (m) => !excludeModelIds.includes(m.id)
  );

  // Only show the quantity-specific client error once the user has
  // picked a model — before that, the button is disabled and the hint
  // below prompts them to pick.
  const quantityError =
    serverValidationErrors?.quantity?.message ||
    zo.errors.quantity()?.message ||
    (assetModelId ? liveFieldErrors?.quantity?.[0] : undefined);

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
        ref={zo.ref}
        method="POST"
        action={`/api/bookings/${bookingId}/model-requests`}
        className="flex flex-col gap-3 sm:flex-row sm:items-start"
      >
        {/* Model picker — DynamicSelect searches the shared model-filters
            endpoint so orgs with 50+ models get proper typeahead. The
            `fieldName` is driven by zorm so the submitted form payload
            matches the server schema exactly. */}
        <div className="min-w-0 flex-1">
          <DynamicSelect
            fieldName={zo.fields.assetModelId()}
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
              setQuantityInput("1");
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
            name={zo.fields.quantity()}
            min={1}
            step={1}
            value={quantityInput}
            onChange={(e) => setQuantityInput(e.target.value)}
            className={tw(
              "h-[38px] w-full rounded-md border bg-white px-3 text-sm",
              "focus:outline-none focus:ring-1",
              quantityError
                ? "border-error-500 focus:border-error-500 focus:ring-error-500"
                : "border-gray-300 focus:border-primary-500 focus:ring-primary-500"
            )}
            aria-label="Quantity to reserve"
            aria-invalid={quantityError ? true : undefined}
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
            disabled={disabled || !isValid || !hasAvailability}
            aria-label="Add model reservation"
            className="h-[38px] w-full sm:w-auto"
          >
            {disabled ? "Adding..." : "Add"}
          </Button>
        </div>
      </fetcher.Form>

      {/* Full-width helper + error line. Kept below the form so the
          control row stays level regardless of whether a hint is
          shown. Priority: server asset-model error → server generic
          error → quantity error (server → zorm → live) → no-availability
          hint → availability hint. */}
      <div className="mt-2 min-h-4 text-xs">
        {serverValidationErrors?.assetModelId?.message ? (
          <p className="text-error-600" role="alert">
            {serverValidationErrors.assetModelId.message}
          </p>
        ) : genericServerError ? (
          <p className="text-error-600" role="alert">
            {genericServerError}
          </p>
        ) : quantityError ? (
          <p className="text-error-600" role="alert">
            {quantityError}
          </p>
        ) : selectedModel && !hasAvailability ? (
          <p className="text-error-600">
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
