/**
 * Blockers for the scanner drawers.
 *
 * A blocker is a reason the drawer's action cannot run yet, with a fix that
 * removes the offending rows. Every scanner drawer builds its list with
 * {@link createBlockers}; `ConfigurableDrawer` then shows it in two places:
 * - a "Needs attention" card at the top of the scrolling list, one line per
 *   blocker with its fix, and "Resolve all" in the card header;
 * - a one-line note above the footer's buttons, so the reason the action is
 *   disabled stays visible after the card scrolls away.
 *
 * @see {@link file://./configurable-drawer.tsx}
 * @see {@link file://./scan-item-group.tsx} the card
 */

import type { ReactNode } from "react";
import { Button } from "~/components/shared/button";
import { ScanItemGroup } from "./scan-item-group";

// Generic blocker configuration type
export type BlockerConfig = {
  /**
   * Optional stable identifier for this blocker. When provided it is used as
   * the React `key` so the rendered `<li>` preserves identity across filter
   * changes. When omitted we fall back to the blocker's position in the
   * original (pre-filter) `blockerConfigs` array, which is stable as long as
   * callers don't reorder that array at runtime. Prefer providing an explicit
   * `id` when adding new call sites (e.g. "already-added", "has-custody").
   */
  id?: string;
  // Checks if this blocker should be shown
  condition: boolean;
  // Count of items that match this blocker condition
  count: number;
  // Message to display for this blocker
  message: (count: number) => ReactNode;
  // Optional: Additional description or notes
  description?: ReactNode;
  // Function to handle resolving this blocker
  onResolve: () => void;
};

// Type for the createBlockers arguments
type CreateBlockersArgs = {
  blockerConfigs: BlockerConfig[];
};

/** One active blocker, tagged with its position in the caller's array. */
type ActiveBlocker = { blocker: BlockerConfig; originalIndex: number };

/** Where a {@link createBlockers} result renders. */
export type BlockersVariant = "card" | "note";

/**
 * The "Needs attention" card: one row per active blocker, "Resolve all" in the
 * header. Module-level so its identity is stable: the drawers create their
 * blockers during render, and a component defined there would remount (and
 * forget whether it was folded) on every render.
 */
function BlockersCard({
  activeBlockers,
  total,
  onResolveAll,
}: {
  activeBlockers: ActiveBlocker[];
  total: number;
  onResolveAll: () => void;
}) {
  return (
    <ScanItemGroup
      label="Needs attention"
      count={total}
      tone="attention"
      openWhenCountGrows
      headerAction={
        <Button
          type="button"
          variant="secondary"
          size="xs"
          className="whitespace-nowrap text-[12px] leading-3"
          onClick={onResolveAll}
          title="Removes all conflicting items from the list"
        >
          Resolve all ({total})
        </Button>
      }
    >
      {activeBlockers.map(({ blocker, originalIndex }) => (
        // Prefer the blocker's own `id`; fall back to its position in the
        // caller's (unfiltered) array, which is stable because callers declare
        // the array once per render in a fixed order.
        <tr
          key={blocker.id ?? `blocker-${originalIndex}`}
          className="border-t border-warning-100"
        >
          <td className="px-4 py-2 text-[12px] text-gray-700">
            <span>{blocker.message(blocker.count)}</span>{" "}
            <Button
              variant="link"
              type="button"
              className="inline text-[12px] font-normal text-gray-700 underline"
              onClick={blocker.onResolve}
            >
              Remove from list
            </Button>
            {blocker.description ? (
              <p className="text-[11px] text-gray-500">{blocker.description}</p>
            ) : null}
          </td>
        </tr>
      ))}
    </ScanItemGroup>
  );
}

/**
 * Creates the blockers for a scanner drawer.
 *
 * @param args.blockerConfigs - Every blocker the drawer declares; only those
 *   whose `condition` holds are shown
 * "Resolve all" runs the `onResolve` of every shown blocker, and nothing else.
 * It is derived here rather than passed in, so it can never remove a row no
 * shown blocker named.
 * @returns `[hasBlockers, Blockers]`. `Blockers({ variant })` returns the card
 *   (default) or the footer note, or `null` when nothing is blocking. Call it
 *   as a function rather than rendering it as `<Blockers />`: it is recreated
 *   on every render, and rendering it as a component would remount the card.
 */
export function createBlockers({ blockerConfigs }: CreateBlockersArgs) {
  const activeBlockers: ActiveBlocker[] = blockerConfigs
    .map((blocker, originalIndex) => ({ blocker, originalIndex }))
    .filter(({ blocker }) => blocker.condition);
  const hasBlockers = activeBlockers.length > 0;

  // Items across every active blocker: what "Resolve all" removes.
  const total = activeBlockers.reduce(
    (sum, { blocker }) => sum + blocker.count,
    0
  );

  // Exactly the fixes the operator can see, one per shown blocker.
  const onResolveAll = () => {
    for (const { blocker } of activeBlockers) blocker.onResolve();
  };

  function Blockers({ variant = "card" }: { variant?: BlockersVariant } = {}) {
    if (!hasBlockers) return null;

    if (variant === "note") {
      return (
        <p className="px-3 pt-2 text-[12px] text-warning-700">
          Resolve {total} {total === 1 ? "issue" : "issues"} above to continue.
        </p>
      );
    }

    return (
      <BlockersCard
        activeBlockers={activeBlockers}
        total={total}
        onResolveAll={onResolveAll}
      />
    );
  }

  return [hasBlockers, Blockers] as const;
}
