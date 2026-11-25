/**
 * Booking Source Editor
 *
 * The "From" section of the adjust quantity dialog: where the units of a
 * standalone pool slice come from. One input per manual placement of the
 * pool plus Unplaced, each with the units free there over the booking
 * window, and an "Auto" button that hands the choice back to the allocation
 * rule.
 *
 * The inputs hold the units each source still has to send out. Units
 * already out are shown next to their source and never move, so on an
 * ongoing or overdue booking only the pending units are editable. The split
 * state lives in {@link useSourceSplit}, owned by the dialog, because the
 * dialog decides on submit whether the split is sent and checks it with
 * `resolveManualSources`.
 *
 * Free figures cover loose units only: units inside kits are not part of any
 * source and are checked against the asset's total stock. The help text says
 * so.
 *
 * @see {@link file://./adjust-booking-asset-quantity-dialog.tsx} the dialog that mounts it
 * @see {@link file://../../modules/booking/sources/source-editor.ts} the data and split rules
 */

import { useCallback, useId, useReducer } from "react";
import { Button } from "~/components/shared/button";
import {
  initialSplitValues,
  type SourceEditorData,
  type SourceSplitValues,
} from "~/modules/booking/sources/source-editor";

/** The split being typed, for one editor data load. */
type SplitState = {
  /** The data the values were started from. */
  source: SourceEditorData | null;
  /** Input text per source key. */
  values: SourceSplitValues;
  /** True once the operator changed any input. */
  edited: boolean;
  /** Client-side message about the split, if any. */
  error: string | null;
};

type SplitAction =
  | { type: "reset"; editor: SourceEditorData | null }
  | { type: "restart" }
  | { type: "change"; key: string; value: string }
  | { type: "error"; message: string | null };

/** Fresh split state for an editor load. */
function startSplit(editor: SourceEditorData | null): SplitState {
  return {
    source: editor,
    values: editor ? initialSplitValues(editor) : {},
    edited: false,
    error: null,
  };
}

function splitReducer(state: SplitState, action: SplitAction): SplitState {
  switch (action.type) {
    case "reset":
      return startSplit(action.editor);
    case "restart":
      return startSplit(state.source);
    case "change":
      return {
        ...state,
        values: { ...state.values, [action.key]: action.value },
        edited: true,
        error: null,
      };
    case "error":
      return { ...state, error: action.message };
  }
}

/** What {@link useSourceSplit} hands the dialog. */
export type SourceSplit = {
  values: SourceSplitValues;
  edited: boolean;
  error: string | null;
  /** Sets one source's input text. */
  change: (key: string, value: string) => void;
  /** Shows or clears the split's client-side message. */
  setError: (message: string | null) => void;
  /** Starts over from the editor data (on every dialog opening). */
  reset: () => void;
};

/**
 * Split state for the From section. Starts over whenever new editor data
 * arrives, so the inputs always begin at the slice's current split. Pass
 * the loaded object itself (a stable reference), never a copy built during
 * render: a new reference restarts the split.
 *
 * @param editor - The slice's editor data, or null/undefined when absent
 * @returns The split and its updaters
 */
export function useSourceSplit(
  editor: SourceEditorData | null | undefined
): SourceSplit {
  const current = editor ?? null;
  const [state, dispatch] = useReducer(splitReducer, current, startSplit);

  // New data (a fresh load) restarts the split in the same render, React's
  // pattern for state derived from a changed prop.
  if (state.source !== current) {
    dispatch({ type: "reset", editor: current });
  }

  const change = useCallback(
    (key: string, value: string) => dispatch({ type: "change", key, value }),
    []
  );
  const setError = useCallback(
    (message: string | null) => dispatch({ type: "error", message }),
    []
  );
  // Stable: restarts from whatever data the split currently follows.
  const reset = useCallback(() => dispatch({ type: "restart" }), []);

  return {
    values: state.values,
    edited: state.edited,
    error: state.error,
    change,
    setError,
    reset,
  };
}

/** Props for {@link BookingSourceEditor}. */
export interface BookingSourceEditorProps {
  /** The slice's sources, free figures and current split. */
  editor: SourceEditorData;
  /** Input text per source key (from {@link useSourceSplit}). */
  values: SourceSplitValues;
  /** True once the operator changed the split. */
  edited: boolean;
  /** Called with a source key and its new input text. */
  onChange: (key: string, value: string) => void;
  /** Called when the operator asks for the automatic choice. */
  onAuto: () => void;
  /** Units the inputs must add up to (pending units after the quantity change). */
  required: number;
  /** Message to show under the section (client or server). */
  error?: string | null;
  /** True while the dialog's submission is in flight. */
  disabled: boolean;
  /** Unit word ("units", "pcs"). */
  unitLabel: string;
}

/**
 * The From section. Renders inside the dialog's form; its inputs carry no
 * `name`, the dialog sends the split as one `sources` field on submit.
 */
export function BookingSourceEditor({
  editor,
  values,
  edited,
  onChange,
  onAuto,
  required,
  error,
  disabled,
  unitLabel,
}: BookingSourceEditorProps) {
  const baseId = useId();
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  const anyOut =
    editor.rows.some((row) => row.out > 0) || editor.unknownOut > 0;

  const typedTotal = editor.rows.reduce((sum, row) => {
    const n = Number(values[row.key]);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  return (
    <fieldset
      className="flex flex-col gap-3 rounded border border-gray-200 p-3"
      aria-describedby={error ? `${helpId} ${errorId}` : helpId}
    >
      <legend className="px-1 text-sm font-semibold text-gray-700">From</legend>

      <div id={helpId} className="flex flex-col gap-1 text-xs text-gray-600">
        <p>
          Choose how many {unitLabel} come from each place. Free counts loose
          units only: units inside kits are not part of any location here and
          are checked against the asset&apos;s total stock.
        </p>
        {anyOut ? (
          <p>
            {unitLabel.charAt(0).toUpperCase() + unitLabel.slice(1)} already out
            stay where they are. Only those still to go out can move.
          </p>
        ) : null}
      </div>

      <ul className="flex flex-col gap-2">
        {editor.rows.map((row) => {
          const inputId = `${baseId}-${row.key}`;
          const hintId = `${inputId}-hint`;
          return (
            <li key={row.key} className="flex items-center gap-3">
              <label
                htmlFor={inputId}
                className="min-w-0 flex-1 truncate text-sm text-gray-700"
              >
                {row.label}
              </label>
              <span id={hintId} className="text-xs text-gray-600">
                {row.free} free
                {row.out > 0 ? ` · ${row.out} out` : ""}
              </span>
              <input
                id={inputId}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={values[row.key] ?? ""}
                onChange={(event) => onChange(row.key, event.target.value)}
                aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                aria-invalid={error ? true : undefined}
                disabled={disabled}
                className="w-20 rounded border border-gray-300 px-2 py-1 text-right text-sm"
              />
            </li>
          );
        })}
      </ul>

      {editor.unassignedPending > 0 ? (
        <p className="text-xs text-warning-700">
          Needs a location: {editor.unassignedPending} {unitLabel}. Place them
          above.
        </p>
      ) : null}
      {editor.unknownOut > 0 ? (
        <p className="text-xs text-gray-600">
          Unknown: {editor.unknownOut} {unitLabel} out from a location that is
          no longer recorded.
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-600" aria-live="polite">
          {edited
            ? `${typedTotal} of ${required} ${unitLabel} placed`
            : editor.mode === "AUTO"
            ? "Chosen automatically"
            : "Chosen by hand"}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          onClick={onAuto}
          disabled={disabled}
        >
          Auto
        </Button>
      </div>

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-error-500">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
