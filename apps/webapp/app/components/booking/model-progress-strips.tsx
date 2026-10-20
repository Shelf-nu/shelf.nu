/**
 * Per-model progress strips for a booking's outstanding model reservations.
 *
 * Renders a foldable summary row ("N models reserved, X / Y fulfilled")
 * above one strip per reserved model. Both booking scanners (Fulfil
 * reservations & check out, and Scan to Assign) mount this so the two
 * screens can never show a different reading of the same reservations.
 *
 * @see {@link file://./model-pending-rows.ts} for `ModelProgress`, the input
 *   shape, and for the pending-row list this same progress feeds.
 */

import { useState } from "react";
import type { JSX } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Progress } from "~/components/shared/progress";
import { tw } from "~/utils/tw";
import type { ModelProgress } from "./model-pending-rows";

/**
 * Props for {@link ModelProgressStrips}.
 */
type ModelProgressStripsProps = {
  /** Fulfilment progress for every model the booking has reserved. */
  progressByModel: ModelProgress[];
  /**
   * Distinguishes this mount's fold-control id
   * (`${idPrefix}-model-progress-list`) from another screen's, so two
   * scanners can mount the strips on the same page without colliding
   * `aria-controls` ids.
   */
  idPrefix: string;
};

/**
 * Foldable per-model progress strips, keyed by reserved `AssetModel`.
 *
 * Starts folded, at every size. This is fixed chrome sharing one screen with
 * the scan list and the check-out button, and the summary row already answers
 * the question an operator opens the screen with ("how far along am I"). The
 * per-model breakdown is a follow-up question, so it costs a click rather
 * than the height of the list.
 *
 * Renders `null` when `progressByModel` is empty, so a booking with no
 * reservations gets no empty chrome.
 *
 * @param props - See {@link ModelProgressStripsProps}.
 */
export function ModelProgressStrips({
  progressByModel,
  idPrefix,
}: ModelProgressStripsProps): JSX.Element | null {
  const [showModels, setShowModels] = useState(false);

  if (progressByModel.length === 0) {
    return null;
  }

  // Totals span every reserved model, folded or not, so the summary is never
  // a statement about only the part that happens to be on screen.
  const totalBooked = progressByModel.reduce(
    (sum, model) => sum + model.booked,
    0
  );
  const totalFulfilled = progressByModel.reduce(
    (sum, model) => sum + model.prefulfilled + model.matched,
    0
  );
  const totalPercentage =
    totalBooked > 0 ? Math.min(100, (totalFulfilled / totalBooked) * 100) : 0;

  const listId = `${idPrefix}-model-progress-list`;

  return (
    <>
      {/* Summary row doubles as the fold control: the aggregate stays
          readable when the per-model strips are hidden. */}
      <button
        type="button"
        onClick={() => setShowModels((prev) => !prev)}
        aria-expanded={showModels}
        // Only reference the list while it exists: folding unmounts it.
        aria-controls={showModels ? listId : undefined}
        className="flex w-full items-center gap-3 text-left"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={tw(
            "size-4 shrink-0 text-gray-500 transition-transform duration-150",
            showModels ? "rotate-0" : "-rotate-90"
          )}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
          {progressByModel.length}{" "}
          {progressByModel.length === 1 ? "model" : "models"} reserved
        </span>
        <span className="shrink-0 text-xs tabular-nums text-gray-600">
          {totalFulfilled} / {totalBooked}
        </span>
        <Progress
          aria-label={`${totalFulfilled} of ${totalBooked} units fulfilled across all reserved models`}
          value={totalPercentage}
          className="h-1.5 w-32 shrink-0"
        />
      </button>

      {/* One strip per reserved model, and a booking can reserve dozens.
          The cap keeps the header a header: it is the drawer's fixed
          chrome, so its height is spent from the same budget as the scan
          list and the check-out button below it.

          Folding UNMOUNTS the list rather than hiding it. A `hidden`
          attribute would not survive the `flex` class: `display: none`
          arrives from the base layer and any display utility overrides
          it, so the list renders on regardless of the state. */}
      {showModels ? (
        <ul
          id={listId}
          className="flex max-h-[176px] flex-col gap-2 overflow-y-auto pr-1"
        >
          {progressByModel.map((model) => {
            // Cumulative fulfilment against the ORIGINAL reservation:
            // includes units scanned in previous sessions (`prefulfilled`)
            // so the operator's mental model ("I reserved 3, I've got 2
            // already") stays consistent on re-entry.
            const fulfilled = model.prefulfilled + model.matched;
            const percentage =
              model.booked > 0
                ? Math.min(100, (fulfilled / model.booked) * 100)
                : 0;
            return (
              <li key={model.assetModelId} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
                  {model.assetModelName}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-gray-600">
                  {fulfilled} / {model.booked}
                </span>
                <Progress
                  aria-label={`${model.assetModelName}: ${fulfilled} of ${model.booked} fulfilled`}
                  value={percentage}
                  className="h-1.5 w-32 shrink-0"
                />
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}
