/**
 * A foldable, boxed group of rows in the booking scan drawers.
 *
 * The check-out and check-in drawers split their list into what was scanned
 * this session and what is still pending. Each group is its own bordered card
 * with its own table, so where one group ends and the next begins is visible at
 * a glance. Both headers share one style; a status dot tells them apart.
 *
 * Folding unmounts the rows instead of hiding them: a `hidden` attribute loses
 * to any display utility on the rows, and folding exists to give back the
 * height they take.
 *
 * @see {@link file://./configurable-drawer.tsx} `renderGroups`
 * @see {@link file://./uses/partial-checkout-drawer.tsx}
 * @see {@link file://./uses/partial-checkin-drawer.tsx}
 */

import { useId, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence } from "framer-motion";
import { ChevronDownIcon } from "lucide-react";
import { tw } from "~/utils/tw";

/** Props for {@link ScanItemGroup}. */
export type ScanItemGroupProps = {
  /** Group name, e.g. "Scanned this session". */
  label: string;
  /** Number of items in the group, shown as a badge beside the label. */
  count: number;
  /**
   * `active` marks what this session has done (green dot), `muted` what is
   * still outstanding (gray dot), `done` what was finished before this session
   * (hollow dot).
   */
  tone: "active" | "muted" | "done";
  /** Whether the group starts open. Defaults to open. */
  defaultOpen?: boolean;
  /**
   * Reopen the group when `count` grows. Set it on the group new scans land
   * in, so folding it never hides the row the operator just scanned.
   */
  openWhenCountGrows?: boolean;
  /** The group's rows: `<tr>` elements. */
  children: ReactNode;
};

/**
 * Renders a bordered card with a fold toggle and the group's rows in their own
 * table.
 */
export function ScanItemGroup({
  label,
  count,
  tone,
  openWhenCountGrows = false,
  defaultOpen = true,
  children,
}: ScanItemGroupProps) {
  const bodyId = useId();
  const [open, setOpen] = useState(defaultOpen);

  // The last count this group rendered with. Compared during render (not in an
  // effect) so a reopen lands in the same paint as the new row.
  const [lastCount, setLastCount] = useState(count);
  if (count !== lastCount) {
    if (openWhenCountGrows && count > lastCount && !open) {
      setOpen(true);
    }
    setLastCount(count);
  }

  return (
    <section className="overflow-hidden rounded-md border border-gray-200">
      <button
        type="button"
        aria-expanded={open}
        // Only while the body is mounted: it is gone when folded.
        aria-controls={open ? bodyId : undefined}
        onClick={() => setOpen((current) => !current)}
        // Above the rows: a new row slides in from above its final position,
        // and would otherwise pass over this header on its way in.
        className="relative z-10 flex w-full items-center gap-2 bg-gray-50 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 hover:bg-gray-100"
      >
        <ChevronDownIcon
          aria-hidden="true"
          className={tw(
            "size-4 shrink-0 text-gray-500 transition-transform",
            !open && "-rotate-90"
          )}
        />
        <span
          aria-hidden="true"
          className={tw(
            "size-2 shrink-0 rounded-full",
            tone === "active" && "bg-green-500",
            tone === "muted" && "bg-gray-400",
            tone === "done" && "border border-gray-400 bg-white"
          )}
        />
        <span>{label}</span>
        <span className="ml-auto rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-gray-600">
          {count}
        </span>
      </button>

      {open ? (
        <table id={bodyId} className="w-full">
          <tbody>
            <AnimatePresence>{children}</AnimatePresence>
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
