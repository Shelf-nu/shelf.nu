import type {
  KeyboardEvent as ReactKeyboardEvent,
  MutableRefObject,
} from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface UseKeyboardReorderOptions<T> {
  /**
   * The current list of items
   */
  items: T[];
  /**
   * Callback to update the items list when reordering occurs
   */
  onReorder: (newItems: T[]) => void;
  /**
   * Function to get a human-readable name for an item (for announcements)
   */
  getItemName: (item: T) => string;
  /**
   * Optional callback when an item is moved (for custom announcements or side effects)
   */
  onItemMoved?: (itemName: string, oldIndex: number, newIndex: number) => void;
}

interface UseKeyboardReorderReturn {
  /**
   * Move an item up in the list
   */
  moveItemUp: (index: number) => void;
  /**
   * Move an item down in the list
   */
  moveItemDown: (index: number) => void;
  /**
   * Handle keyboard events for reordering
   */
  handleKeyDown: (
    event: ReactKeyboardEvent<HTMLElement>,
    index: number
  ) => void;
  /**
   * Current announcement for screen readers
   */
  announcement: string;
  /**
   * Array of refs for managing focus on items
   */
  itemRefs: MutableRefObject<(HTMLElement | null)[]>;
  /**
   * Set focus to a specific item by index
   */
  setItemFocus: (index: number) => void;
}

/**
 * A reusable hook for implementing keyboard-accessible reordering of lists.
 * Implements WCAG 2.1 AA compliant keyboard navigation for rearrangeable lists.
 *
 * @example
 * ```tsx
 * const { moveItemUp, moveItemDown, handleKeyDown, announcement, itemRefs } =
 *   useKeyboardReorder({
 *     items: columns,
 *     onReorder: setColumns,
 *     getItemName: (col) => col.name,
 *   });
 * ```
 */
export function useKeyboardReorder<T>({
  items,
  onReorder,
  getItemName,
  onItemMoved,
}: UseKeyboardReorderOptions<T>): UseKeyboardReorderReturn {
  const [announcement, setAnnouncement] = useState("");
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const announcementTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  // Clean up timeout on unmount
  useEffect(
    () => () => {
      if (announcementTimeoutRef.current) {
        clearTimeout(announcementTimeoutRef.current);
      }
    },
    []
  );

  // Clear announcement after a short delay so screen readers can read it
  const announceChange = useCallback((message: string) => {
    // Clear any existing timeout
    if (announcementTimeoutRef.current) {
      clearTimeout(announcementTimeoutRef.current);
    }

    setAnnouncement(message);
    announcementTimeoutRef.current = setTimeout(() => {
      setAnnouncement("");
      announcementTimeoutRef.current = null;
    }, 1000);
  }, []);

  const setItemFocus = useCallback((index: number) => {
    // Use setTimeout to ensure DOM has updated
    setTimeout(() => {
      itemRefs.current[index]?.focus();
    }, 0);
  }, []);

  const moveItemUp = useCallback(
    (index: number) => {
      if (index <= 0) {
        announceChange("Already at the top of the list");
        return;
      }

      const newItems = [...items];
      const [movedItem] = newItems.splice(index, 1);
      newItems.splice(index - 1, 0, movedItem);

      onReorder(newItems);

      const itemName = getItemName(movedItem);
      announceChange(
        `${itemName} moved up. Now at position ${index} of ${items.length}`
      );

      if (onItemMoved) {
        onItemMoved(itemName, index, index - 1);
      }

      // Restore focus to the moved item
      setItemFocus(index - 1);
    },
    [items, onReorder, getItemName, onItemMoved, announceChange, setItemFocus]
  );

  const moveItemDown = useCallback(
    (index: number) => {
      if (index >= items.length - 1) {
        announceChange("Already at the bottom of the list");
        return;
      }

      const newItems = [...items];
      const [movedItem] = newItems.splice(index, 1);
      newItems.splice(index + 1, 0, movedItem);

      onReorder(newItems);

      const itemName = getItemName(movedItem);
      announceChange(
        `${itemName} moved down. Now at position ${index + 2} of ${
          items.length
        }`
      );

      if (onItemMoved) {
        onItemMoved(itemName, index, index + 1);
      }

      // Restore focus to the moved item
      setItemFocus(index + 1);
    },
    [items, onReorder, getItemName, onItemMoved, announceChange, setItemFocus]
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
      // Alt+ArrowUp: Move item up
      if (event.key === "ArrowUp" && event.altKey) {
        event.preventDefault();
        moveItemUp(index);
        return;
      }

      // Alt+ArrowDown: Move item down
      if (event.key === "ArrowDown" && event.altKey) {
        event.preventDefault();
        moveItemDown(index);
        return;
      }
    },
    [moveItemUp, moveItemDown]
  );

  return {
    moveItemUp,
    moveItemDown,
    handleKeyDown,
    announcement,
    itemRefs,
    setItemFocus,
  };
}
