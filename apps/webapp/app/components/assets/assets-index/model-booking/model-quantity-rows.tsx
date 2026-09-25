/**
 * Per-model quantity rows, shared by the model view's two booking dialogs.
 *
 * One row per selected asset model: its name, how many units to add, a control
 * to drop the row, and — once a booking window is known — a hint comparing the
 * projected total against what is free in that window.
 *
 * The write these rows feed is ADDITIVE: three units typed against a model that
 * already reserves five produce eight. The input is therefore labelled `Add`
 * and the hint states the projected total, so a user sees the eight before
 * submitting rather than discovering it on the booking afterwards.
 *
 * Availability is a hint, never a guard. It is computed before submission and
 * can be stale by the time the write runs, so the reservation transaction is
 * the only correctness boundary — it measures the whole batch and refuses all
 * of it at once. Nothing here disables anything on the strength of the hint,
 * and a consumer must not either: a client-side gate would trade an honest
 * all-or-nothing error for a control the user cannot explain.
 *
 * Purely presentational — quantities, selection and submission all live with
 * the dialog that renders this list.
 *
 * @see {@link file://./../../../../modules/booking-model-request/service.server.ts} — the transactional guard the hint anticipates
 */
import { useId } from "react";
import { Button } from "~/components/shared/button";
import { numberInputWheelGuard } from "~/utils/number-input-wheel-guard";

/**
 * The fewest units a row may add, and what a row adds until the user says
 * otherwise. Adding nothing is not an intent — a model the user does not want
 * is removed from the list instead.
 */
const MINIMUM_QUANTITY = 1;

/** One asset model the user has selected, as this list renders it. */
export type ModelQuantityRow = {
  /** `AssetModel.id` — the key every callback reports back. */
  assetModelId: string;
  /** `AssetModel.name`, shown as the row's title. */
  name: string;
  /** Units already reserved on the chosen booking, when one is chosen. */
  alreadyReserved?: number;
  /** Units free in the booking's window, when it is known. */
  available?: number;
};

/** Props for {@link ModelQuantityRows}. */
export type ModelQuantityRowsProps = {
  /** The selected models, rendered in the order given. */
  rows: ModelQuantityRow[];
  /**
   * Units to add, keyed by `assetModelId`. A model with no entry adds one, so
   * a caller may seed the map lazily and still render a usable list.
   */
  quantities: Record<string, number>;
  /** Reports a model's new number of units to add. Never below one. */
  onChange: (assetModelId: string, quantity: number) => void;
  /** Reports the model the user dropped from the selection. */
  onRemove: (assetModelId: string) => void;
};

/**
 * The line under a row's name, or `null` when there is nothing honest to say.
 *
 * Availability is only meaningful against a booking window, so without one the
 * row says nothing rather than rendering a number computed against no window
 * at all. With one, the hint compares the PROJECTED total — already reserved
 * plus being added — against availability, because the total is what the
 * reservation transaction checks.
 *
 * A model the booking does not reserve yet reports no reserved clause: a
 * leading "0 already reserved" is noise, and `alreadyReserved` is absent or
 * zero for exactly that case.
 *
 * @param args.quantity - Units the user is adding
 * @param args.alreadyReserved - Units the chosen booking already reserves
 * @param args.available - Units free in the chosen booking's window
 * @returns The hint text, or `null` when no window is known
 */
function buildQuantityHint({
  quantity,
  alreadyReserved,
  available,
}: {
  quantity: number;
  alreadyReserved?: number;
  available?: number;
}): string | null {
  if (available === undefined) {
    return null;
  }

  const reserved = alreadyReserved ?? 0;
  const projectedTotal = reserved + quantity;
  const projection = `adding ${quantity} → ${projectedTotal} of ${available} available`;

  return reserved > 0
    ? `${reserved} already reserved · ${projection}`
    : projection;
}

/**
 * A list of selected asset models with a per-model quantity to add.
 *
 * Quantity is always per model: one number shared across different models
 * would be a coincidence rather than an intent. Rows are removable here so a
 * user who over-selected drops one instead of closing the dialog and starting
 * the selection again.
 *
 * @param props - See {@link ModelQuantityRowsProps}
 * @returns The list, or nothing when no models are selected — the empty state
 *   belongs to the dialog, which knows why the list is empty
 */
export function ModelQuantityRows({
  rows,
  quantities,
  onChange,
  onRemove,
}: ModelQuantityRowsProps) {
  // Namespaces the label/description wiring so two lists on one page cannot
  // point a label at the other list's input.
  const idPrefix = useId();

  if (rows.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col divide-y divide-gray-100 rounded-md border border-gray-200">
      {rows.map((row) => (
        <ModelQuantityRowItem
          key={row.assetModelId}
          row={row}
          quantity={quantities[row.assetModelId] ?? MINIMUM_QUANTITY}
          idPrefix={idPrefix}
          onChange={onChange}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}

/**
 * One model's row: name, hint, quantity input and remove control.
 *
 * @param props.row - The model this row renders
 * @param props.quantity - Units currently being added for it
 * @param props.idPrefix - Namespace shared by every row in one list
 * @param props.onChange - Reports a new quantity for this model
 * @param props.onRemove - Reports that this model was dropped
 */
function ModelQuantityRowItem({
  row,
  quantity,
  idPrefix,
  onChange,
  onRemove,
}: {
  row: ModelQuantityRow;
  quantity: number;
  idPrefix: string;
  onChange: (assetModelId: string, quantity: number) => void;
  onRemove: (assetModelId: string) => void;
}) {
  const inputId = `${idPrefix}model-quantity-${row.assetModelId}`;
  const nameId = `${idPrefix}model-name-${row.assetModelId}`;
  const hintId = `${idPrefix}model-hint-${row.assetModelId}`;

  const hint = buildQuantityHint({
    quantity,
    alreadyReserved: row.alreadyReserved,
    available: row.available,
  });

  return (
    <li className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span
          id={nameId}
          className="truncate text-sm font-medium text-gray-900"
        >
          {row.name}
        </span>
        {hint ? (
          <p id={hintId} className="text-xs tabular-nums text-gray-500">
            {hint}
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/* `Add`, on every row and in full view: the one word that says the
            number joins the reservation instead of replacing it. */}
        <label htmlFor={inputId} className="text-sm font-medium text-gray-700">
          Add
        </label>
        <input
          id={inputId}
          type="number"
          {...numberInputWheelGuard}
          min={MINIMUM_QUANTITY}
          step={1}
          value={quantity}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10);
            onChange(
              row.assetModelId,
              Number.isNaN(parsed) || parsed < MINIMUM_QUANTITY
                ? MINIMUM_QUANTITY
                : parsed
            );
          }}
          // The label is one word for everyone's sake; the name and the hint
          // carry the context it leaves out.
          aria-describedby={hint ? `${nameId} ${hintId}` : nameId}
          className="h-[38px] w-20 rounded-md border border-gray-300 bg-white px-2 text-sm tabular-nums focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        <Button
          type="button"
          variant="secondary"
          icon="x"
          label={`Remove ${row.name}`}
          onClick={() => onRemove(row.assetModelId)}
        />
      </div>
    </li>
  );
}
