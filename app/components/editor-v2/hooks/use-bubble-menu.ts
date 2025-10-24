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
      const left = (start.left + end.right) / 2 - 60;
      const top = Math.min(start.top, end.top) - 44;
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
