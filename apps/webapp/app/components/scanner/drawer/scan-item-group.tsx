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
   * What the group holds, shown by its dot (and, for `attention`, its frame):
   * - `active`: done this session (green dot)
   * - `muted`: still outstanding (gray dot)
   * - `done`: finished before this session (hollow dot)
   * - `notice`: worth a look but not blocking, e.g. an unexpected audit find
   *   (amber dot)
   * - `attention`: blocks the drawer's action (amber frame and header)
   */
  tone: "active" | "muted" | "done" | "notice" | "attention";
  /**
   * A control shown at the right of the header, beside the fold toggle (never
   * inside it: a button inside a button is invalid and swallows the click).
   */
  headerAction?: ReactNode;
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
  headerAction,
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
    <section
      className={tw(
        "overflow-hidden rounded-md border",
        tone === "attention" ? "border-warning-200" : "border-gray-200"
      )}
    >
      <div
        // Above the rows: a new row slides in from above its final position,
        // and would otherwise pass over this header on its way in.
        className={tw(
          "relative z-10 flex items-center gap-2 pr-2",
          tone === "attention" ? "bg-warning-25" : "bg-gray-50"
        )}
      >
        <button
          type="button"
          aria-expanded={open}
          // Only while the body is mounted: it is gone when folded.
          aria-controls={open ? bodyId : undefined}
          onClick={() => setOpen((current) => !current)}
          className={tw(
            "flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-3 text-left text-xs font-semibold uppercase tracking-wide",
            tone === "attention"
              ? "text-warning-700 hover:bg-warning-50"
              : "text-gray-700 hover:bg-gray-100"
          )}
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={tw(
              "size-4 shrink-0 transition-transform",
              tone === "attention" ? "text-warning-600" : "text-gray-500",
              !open && "-rotate-90"
            )}
          />
          <span
            aria-hidden="true"
            className={tw(
              "size-2 shrink-0 rounded-full",
              tone === "active" && "bg-green-500",
              tone === "muted" && "bg-gray-400",
              tone === "done" && "border border-gray-400 bg-white",
              (tone === "notice" || tone === "attention") && "bg-warning-500"
            )}
          />
          <span className="truncate">{label}</span>
          <span className="ml-auto shrink-0 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-medium normal-case tracking-normal text-gray-600">
            {count}
          </span>
        </button>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>

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
