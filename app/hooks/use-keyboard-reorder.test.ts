import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useKeyboardReorder } from "./use-keyboard-reorder";

interface TestItem {
  id: string;
  name: string;
}

describe("useKeyboardReorder", () => {
  const mockItems: TestItem[] = [
    { id: "1", name: "First" },
    { id: "2", name: "Second" },
    { id: "3", name: "Third" },
  ];

  let mockOnReorder: ReturnType<typeof vi.fn>;
  let mockOnItemMoved: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnReorder = vi.fn();
    mockOnItemMoved = vi.fn();
    vi.clearAllMocks();
  });

  describe("initialization", () => {
    it("should initialize with correct default state", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      expect(result.current.announcement).toBe("");
      expect(result.current.itemRefs.current).toEqual([]);
      expect(typeof result.current.moveItemUp).toBe("function");
      expect(typeof result.current.moveItemDown).toBe("function");
      expect(typeof result.current.handleKeyDown).toBe("function");
      expect(typeof result.current.setItemFocus).toBe("function");
    });
  });

  describe("moveItemUp", () => {
    it("should move an item up one position", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      act(() => {
        result.current.moveItemUp(1);
      });

      expect(mockOnReorder).toHaveBeenCalledWith([
        { id: "2", name: "Second" },
        { id: "1", name: "First" },
        { id: "3", name: "Third" },
      ]);

      expect(result.current.announcement).toBe(
        "Second moved up. Now at position 1 of 3"
      );
    });

    it("should not move the first item up", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      act(() => {
        result.current.moveItemUp(0);
      });

      expect(mockOnReorder).not.toHaveBeenCalled();
      expect(result.current.announcement).toBe(
        "Already at the top of the list"
      );
    });

    it("should call onItemMoved callback when provided", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
          onItemMoved: mockOnItemMoved,
        })
      );

      act(() => {
        result.current.moveItemUp(2);
      });

      expect(mockOnItemMoved).toHaveBeenCalledWith("Third", 2, 1);
    });
  });

  describe("moveItemDown", () => {
    it("should move an item down one position", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      act(() => {
        result.current.moveItemDown(0);
      });

      expect(mockOnReorder).toHaveBeenCalledWith([
        { id: "2", name: "Second" },
        { id: "1", name: "First" },
        { id: "3", name: "Third" },
      ]);

      expect(result.current.announcement).toBe(
        "First moved down. Now at position 2 of 3"
      );
    });

    it("should not move the last item down", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      act(() => {
        result.current.moveItemDown(2);
      });

      expect(mockOnReorder).not.toHaveBeenCalled();
      expect(result.current.announcement).toBe(
        "Already at the bottom of the list"
      );
    });

    it("should call onItemMoved callback when provided", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
          onItemMoved: mockOnItemMoved,
        })
      );

      act(() => {
        result.current.moveItemDown(0);
      });

      expect(mockOnItemMoved).toHaveBeenCalledWith("First", 0, 1);
    });
  });

  describe("handleKeyDown", () => {
    it("should move item up on Alt+ArrowUp", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      const mockEvent = {
        key: "ArrowUp",
        altKey: true,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.handleKeyDown(mockEvent, 1);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockOnReorder).toHaveBeenCalled();
    });

    it("should move item down on Alt+ArrowDown", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      const mockEvent = {
        key: "ArrowDown",
        altKey: true,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.handleKeyDown(mockEvent, 0);
      });

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(mockOnReorder).toHaveBeenCalled();
    });

    it("should not trigger without Alt key", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      const mockEvent = {
        key: "ArrowUp",
        altKey: false,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.handleKeyDown(mockEvent, 1);
      });

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockOnReorder).not.toHaveBeenCalled();
    });

    it("should not trigger on other keys", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      const mockEvent = {
        key: "Enter",
        altKey: true,
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent;

      act(() => {
        result.current.handleKeyDown(mockEvent, 1);
      });

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
      expect(mockOnReorder).not.toHaveBeenCalled();
    });
  });

  describe("announcements", () => {
    it("should clear announcement after timeout", () => {
      vi.useFakeTimers();

      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      act(() => {
        result.current.moveItemDown(0);
      });

      expect(result.current.announcement).toBe(
        "First moved down. Now at position 2 of 3"
      );

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.announcement).toBe("");

      vi.useRealTimers();
    });
  });

  describe("focus management", () => {
    it("should provide itemRefs array", () => {
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      expect(Array.isArray(result.current.itemRefs.current)).toBe(true);
    });

    it("should call focus on element after moving up", () => {
      vi.useFakeTimers();

      const mockElement = {
        focus: vi.fn(),
      } as unknown as HTMLElement;

      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: mockItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      // Simulate setting refs
      act(() => {
        result.current.itemRefs.current[0] = mockElement;
        result.current.itemRefs.current[1] = mockElement;
      });

      act(() => {
        result.current.moveItemUp(1);
      });

      act(() => {
        vi.runAllTimers();
      });

      expect(mockElement.focus).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe("edge cases", () => {
    it("should handle single item list", () => {
      const singleItem = [{ id: "1", name: "Only" }];
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: singleItem,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      act(() => {
        result.current.moveItemUp(0);
      });

      expect(mockOnReorder).not.toHaveBeenCalled();

      act(() => {
        result.current.moveItemDown(0);
      });

      expect(mockOnReorder).not.toHaveBeenCalled();
    });

    it("should handle empty list", () => {
      const emptyItems: TestItem[] = [];
      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: emptyItems,
          onReorder: mockOnReorder,
          getItemName: (item) => item.name,
        })
      );

      act(() => {
        result.current.moveItemUp(0);
      });

      expect(mockOnReorder).not.toHaveBeenCalled();
    });
  });

  describe("custom getItemName", () => {
    it("should use custom getItemName for announcements", () => {
      interface CustomItem {
        id: string;
        title: string;
        priority: number;
      }

      const customItems: CustomItem[] = [
        { id: "1", title: "Task A", priority: 1 },
        { id: "2", title: "Task B", priority: 2 },
      ];

      const { result } = renderHook(() =>
        useKeyboardReorder({
          items: customItems,
          onReorder: mockOnReorder,
          getItemName: (item) => `${item.title} (Priority ${item.priority})`,
        })
      );

      act(() => {
        result.current.moveItemDown(0);
      });

      expect(result.current.announcement).toBe(
        "Task A (Priority 1) moved down. Now at position 2 of 2"
      );
    });
  });
});
