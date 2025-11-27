import { useCallback, useState } from "react";
import type { EditorState } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

import type { BubbleState } from "../types";

export function useBubbleMenu() {
  const [bubbleState, setBubbleState] = useState<BubbleState>({
    visible: false,
    left: 0,
    top: 0,
  });

  const updateBubble = useCallback((state: EditorState, view: EditorView) => {
    const { from, to } = state.selection;
    if (from === to) {
      setBubbleState((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
      return;
    }
    try {
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      // Get the editor container's position to convert viewport coords to container-relative
      const containerRect = (view.dom as HTMLElement).getBoundingClientRect();
      const left = (start.left + end.right) / 2 - 60 - containerRect.left;
      const top = Math.min(start.top, end.top) - 44 - containerRect.top;
      setBubbleState({ visible: true, left, top });
    } catch {
      setBubbleState((prev) =>
        prev.visible ? { ...prev, visible: false } : prev
      );
    }
  }, []);

  return {
    bubbleState,
    updateBubble,
  };
}
