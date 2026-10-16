/**
 * Drag-to-reorder primitives shared by framer-motion `Reorder` lists: the
 * handle a drag starts from, the props that lift the dragged row, and the hint
 * line. Pair them with `useKeyboardReorder` for the Alt+Arrow moves.
 *
 * @see {@link file://./../../hooks/use-keyboard-reorder.ts}
 * @see {@link file://./../assets/assets-index/configure-columns-dropdown.tsx}
 */
import { forwardRef } from "react";
import type { KeyboardEvent } from "react";
import type { DragControls } from "framer-motion";
import { HandleIcon } from "~/components/icons/library";
import { tw } from "~/utils/tw";

/**
 * Props for a `Reorder.Item` dragged by a {@link ReorderHandle}. `relative` lets
 * the zIndex Reorder puts on the dragged item take effect, and the white
 * background stops its text from showing through the row it passes over.
 */
export const reorderItemProps = {
  className: "relative select-none rounded-md bg-white",
  whileDrag: { boxShadow: "0 4px 12px rgba(16, 24, 40, 0.12)" },
};

/**
 * Drag handle for a `Reorder.Item` rendered with `dragListener={false}`. It is
 * the only place a drag starts, so the rest of the row stays clickable and
 * scrolls on touch. `onKeyDown` takes the Alt+Arrow moves from
 * `useKeyboardReorder`.
 */
export const ReorderHandle = forwardRef<
  HTMLButtonElement,
  {
    dragControls: DragControls;
    /** Name of the item, read out as "Reorder {label}". */
    label: string;
    onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
    /** Id of the element holding the keyboard instructions. */
    describedById: string;
  }
>(({ dragControls, label, onKeyDown, describedById }, ref) => (
  <button
    ref={ref}
    type="button"
    data-reorder-handle
    onPointerDown={(event) => dragControls.start(event)}
    onKeyDown={onKeyDown}
    className="flex cursor-grab touch-none items-center p-1 text-gray-500 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
    aria-label={`Reorder ${label}`}
    aria-describedby={describedById}
    aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
    title="Drag to reorder"
  >
    <span className="block h-3 w-2">
      <HandleIcon />
    </span>
  </button>
));
ReorderHandle.displayName = "ReorderHandle";

/**
 * "Drag to reorder" hint that swaps to the keyboard shortcut while one of the
 * list's handles has keyboard focus. Render it inside a `group` element that
 * also contains the handles.
 */
export function ReorderHint({ className }: { className?: string }) {
  return (
    <div className={tw("text-xs text-gray-400", className)}>
      <span className="group-has-[[data-reorder-handle]:focus-visible]:hidden">
        Drag to reorder
      </span>
      <span className="hidden group-has-[[data-reorder-handle]:focus-visible]:inline">
        Alt + ↑ / ↓ to move
      </span>
    </div>
  );
}
