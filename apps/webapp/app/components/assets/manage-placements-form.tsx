/**
 * Manage Placements Form
 *
 * Multi-row editor used by the asset-overview "Manage placements"
 * dialog (Phase 4b-Polish-3 Fix 2). Lets the user spread a
 * QUANTITY_TRACKED asset across multiple locations at distinct
 * per-location quantities, or remove placements entirely.
 *
 * UX shape:
 *  - One row per placement: location dropdown + qty input + remove
 *    button.
 *  - "Add another location" button appends a row when there's room.
 *  - Live "placed / unplaced" indicator using `Asset.quantity` as the
 *    bound (mirrors the rule enforced server-side in
 *    `replaceAssetPlacements`).
 *  - Hidden JSON field `placements` carries the full set on submit.
 *
 * INDIVIDUAL assets get the same UI but capped at one row by the
 * "Add another location" disabled state — the server-side validator
 * is the ultimate guard against tampering.
 *
 * @see {@link file://./../../routes/_layout+/assets.$assetId.overview.manage-placements.tsx}
 * @see {@link file://./../../modules/asset/service.server.ts} — `replaceAssetPlacements`
 */
import { useMemo, useState } from "react";
import { Form } from "~/components/custom-form";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";

type LocationOption = {
  id: string;
  name: string;
};

type PlacementRow = {
  /** Stable client-side row id so unmount/reorder doesn't lose focus. */
  rowId: string;
  /** Selected location id; empty string means "not picked yet". */
  locationId: string;
  /** Qty for QUANTITY_TRACKED rows; INDIVIDUAL ignores this server-side. */
  quantity: number;
};

export interface ManagePlacementsFormProps {
  /** True for QUANTITY_TRACKED assets — gates the qty input + sum line. */
  isQty: boolean;
  /** `Asset.quantity` — the upper bound on `sum(quantity)`. Null for INDIVIDUAL. */
  assetQuantity: number | null;
  /** Unit-of-measure suffix. Null falls back to "units". */
  unitOfMeasure: string | null;
  /** Workspace locations available to pick. */
  locations: LocationOption[];
  /**
   * Pre-existing MANUAL placements; pre-fills the editable rows. The
   * route filters kit-driven rows out of this list so the form's diff
   * math operates on manual placements only.
   */
  initialPlacements: Array<{
    locationId: string;
    locationName: string;
    quantity: number;
  }>;
  /**
   * Polish-4: kit-driven placements (read-only). Rendered above the
   * editable rows so users see the full picture — these eat into the
   * "Unplaced" pool but the dialog can't modify them. To change a kit-
   * driven row, the user edits the kit (membership qty or kit
   * location).
   */
  kitDrivenPlacements?: Array<{
    locationId: string;
    locationName: string;
    quantity: number;
    kit: { id: string; name: string };
  }>;
  /** Server-side error message surfaced as a red banner. */
  serverErrorMessage: string | null;
}

let rowCounter = 0;
function nextRowId() {
  rowCounter += 1;
  return `row-${rowCounter}`;
}

/**
 * Renders the multi-row placement editor. Owns row state + validation
 * messages; submits as a single hidden JSON field to the route action.
 */
export function ManagePlacementsForm({
  isQty,
  assetQuantity,
  unitOfMeasure,
  locations,
  initialPlacements,
  kitDrivenPlacements,
  serverErrorMessage,
}: ManagePlacementsFormProps) {
  const disabled = useDisabled();
  const unit = unitOfMeasure || "units";
  const totalPool = assetQuantity ?? 1;
  const kitDriven = kitDrivenPlacements ?? [];
  const kitDrivenSum = kitDriven.reduce((s, p) => s + p.quantity, 0);

  const [rows, setRows] = useState<PlacementRow[]>(() =>
    initialPlacements.length > 0
      ? initialPlacements.map((p) => ({
          rowId: nextRowId(),
          locationId: p.locationId,
          quantity: p.quantity,
        }))
      : [
          {
            rowId: nextRowId(),
            locationId: "",
            quantity: isQty ? totalPool : 1,
          },
        ]
  );

  /** Sum of currently-entered placements — drives the placed/unplaced indicator. */
  const placedSum = useMemo(
    () => rows.reduce((s, r) => (r.locationId ? s + (r.quantity || 0) : s), 0),
    [rows]
  );

  /** Locations not yet picked, so each dropdown only offers fresh options. */
  const availableLocations = useMemo(
    () => (locationId: string) =>
      locations.filter(
        (loc) =>
          loc.id === locationId || !rows.some((r) => r.locationId === loc.id)
      ),
    [locations, rows]
  );

  /**
   * Client-side validation messages — server is the ultimate guard.
   *
   * The sum check uses `placedSum + kitDrivenSum` because the kit-
   * driven rows survive the edit and the DEFERRED trigger checks the
   * combined total at COMMIT. Surfacing the breakdown in the message
   * keeps the diagnostic actionable.
   */
  const clientError = useMemo(() => {
    if (!isQty) return null;
    const projectedSum = placedSum + kitDrivenSum;
    if (projectedSum > totalPool) {
      return kitDrivenSum > 0
        ? `Your manual placements (${placedSum}) plus kit-driven placements (${kitDrivenSum}) sum to ${projectedSum}, which exceeds the asset's total quantity (${totalPool}).`
        : `Sum of placements (${placedSum}) exceeds the asset's total quantity (${totalPool}).`;
    }
    const seen = new Set<string>();
    for (const r of rows) {
      if (!r.locationId) continue;
      if (seen.has(r.locationId)) {
        return "Each location can appear at most once. Remove the duplicate row.";
      }
      seen.add(r.locationId);
    }
    return null;
  }, [isQty, placedSum, kitDrivenSum, totalPool, rows]);

  // "Unplaced" excludes kit-driven rows from the pool the user can
  // claim with manual placements — they're already spoken for.
  const unplaced = Math.max(0, totalPool - placedSum - kitDrivenSum);

  const canAddRow = isQty
    ? rows.length < locations.length && unplaced > 0
    : rows.length === 0;

  const addRow = () => {
    const defaultQty = isQty ? Math.max(1, unplaced) : 1;
    setRows((prev) => [
      ...prev,
      { rowId: nextRowId(), locationId: "", quantity: defaultQty },
    ]);
  };

  const removeRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.rowId !== rowId));
  };

  const updateLocation = (rowId: string, locationId: string) => {
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, locationId } : r))
    );
  };

  const updateQuantity = (rowId: string, raw: number) => {
    if (!Number.isFinite(raw)) return;
    const capped = Math.max(1, Math.min(Math.floor(raw), totalPool));
    setRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, quantity: capped } : r))
    );
  };

  /** Build the JSON payload submitted to the action — drops empty rows. */
  const placementsPayload = useMemo(
    () =>
      JSON.stringify(
        rows
          .filter((r) => r.locationId)
          .map((r) => ({
            locationId: r.locationId,
            quantity: isQty ? r.quantity : 1,
          }))
      ),
    [rows, isQty]
  );

  return (
    <Form method="post">
      {/* Read-only kit-driven placements (Polish-4). Surfaced ABOVE the
          editable rows so users see the full picture — these eat into
          the Unplaced pool but can only change via the kit (membership
          qty or kit location). Hidden when the asset isn't in any kit. */}
      {kitDriven.length > 0 ? (
        <div className="mb-4 space-y-2">
          <p className="text-xs font-medium text-gray-500">
            Placements managed by kits (read-only)
          </p>
          {kitDriven.map((p) => (
            <div
              key={`${p.locationId}-${p.kit.id}`}
              className="flex items-center justify-between gap-2 rounded-md border border-blue-100 bg-blue-50/50 p-2 text-sm"
              title={`Change the kit "${p.kit.name}" (location or per-asset qty) to modify this placement.`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-gray-700">{p.locationName}</span>
                <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                  via kit {p.kit.name}
                </span>
              </div>
              {isQty ? (
                <span className="shrink-0 text-xs tabular-nums text-gray-500">
                  {p.quantity} {unit}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {/* Placement rows */}
      <div className="mb-4 space-y-3">
        {rows.map((row, idx) => (
          <div
            key={row.rowId}
            className="flex items-center gap-2 rounded-md border border-gray-200 bg-white p-2"
          >
            <select
              value={row.locationId}
              onChange={(e) => updateLocation(row.rowId, e.target.value)}
              disabled={disabled}
              className="h-9 min-w-0 flex-1 rounded-md border border-gray-300 px-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              aria-label={`Location for placement ${idx + 1}`}
            >
              <option value="">— Select a location —</option>
              {availableLocations(row.locationId).map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
            {isQty ? (
              <div className="flex shrink-0 items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={totalPool}
                  value={row.quantity}
                  onChange={(e) =>
                    updateQuantity(row.rowId, Number(e.target.value))
                  }
                  disabled={disabled}
                  className="h-9 w-20 rounded-md border border-gray-300 px-2 text-center text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  aria-label={`Quantity for placement ${idx + 1}`}
                />
                <span className="text-xs text-gray-400">{unit}</span>
              </div>
            ) : null}
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              onClick={() => removeRow(row.rowId)}
              disabled={disabled}
              aria-label={`Remove placement ${idx + 1}`}
            >
              ×
            </Button>
          </div>
        ))}

        {/* Add-row button */}
        <Button
          type="button"
          variant="secondary"
          width="full"
          disabled={disabled || !canAddRow}
          onClick={addRow}
        >
          + Add{rows.length > 0 ? " another" : ""} location
        </Button>
      </div>

      {/* Placed / unplaced indicator (qty-tracked only). Splits the
          allocation into the manual rows the form edits, the kit-
          driven rows the form treats as read-only, and the unplaced
          remainder. Total always equals `Asset.quantity`. */}
      {isQty ? (
        <div className="mb-4 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
          <div className="flex justify-between text-gray-700">
            <span>Placed (manual)</span>
            <span className="tabular-nums">
              {placedSum} / {totalPool} {unit}
            </span>
          </div>
          {kitDrivenSum > 0 ? (
            <div className="flex justify-between text-blue-700">
              <span>Via kits</span>
              <span className="tabular-nums">
                {kitDrivenSum} {unit}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between text-gray-500">
            <span>Unplaced</span>
            <span className="tabular-nums">
              {unplaced} {unit}
            </span>
          </div>
        </div>
      ) : null}

      {clientError ? (
        <div className="mb-4 rounded-md border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-800">
          {clientError}
        </div>
      ) : null}

      {serverErrorMessage ? (
        <div className="mb-4 rounded-md border border-error-200 bg-error-50 px-3 py-2 text-sm text-error-800">
          {serverErrorMessage}
        </div>
      ) : null}

      <input type="hidden" name="placements" value={placementsPayload} />

      <div className="flex gap-3">
        <Button to=".." variant="secondary" width="full" disabled={disabled}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          width="full"
          disabled={disabled || !!clientError}
        >
          Save placements
        </Button>
      </div>
    </Form>
  );
}
