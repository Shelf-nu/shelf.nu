import type { RefObject } from "react";
import { useCallback, useState } from "react";
import type { EditorView } from "prosemirror-view";

import type { RawBlockDialogState } from "../types";

export function useRawBlockDialog(viewRef: RefObject<EditorView | null>) {
  const [rawBlockDialog, setRawBlockDialog] = useState<RawBlockDialogState>({
    open: false,
    raw: "",
    pos: null,
  });

  const openRawBlockEditor = useCallback((pos: number, raw: string) => {
    setRawBlockDialog({ open: true, pos, raw });
  }, []);

  const closeRawBlockEditor = useCallback(() => {
    setRawBlockDialog({ open: false, pos: null, raw: "" });
  }, []);

  const applyRawBlockEdit = useCallback(() => {
    const view = viewRef.current;
    if (!view || rawBlockDialog.pos == null) {
      closeRawBlockEditor();
      return;
    }
    const { pos, raw } = rawBlockDialog;
    const node = view.state.doc.nodeAt(pos);
    if (!node || node.type.name !== "raw_block") {
      closeRawBlockEditor();
      return;
    }
    const tr = view.state.tr.setNodeMarkup(pos, undefined, { raw });
    view.dispatch(tr);
    view.focus();
    closeRawBlockEditor();
  }, [rawBlockDialog, viewRef, closeRawBlockEditor]);

  const setRawBlockContent = useCallback((raw: string) => {
    setRawBlockDialog((state) => ({ ...state, raw }));
  }, []);

  return {
    rawBlockDialog,
    openRawBlockEditor,
    closeRawBlockEditor,
    applyRawBlockEdit,
    setRawBlockContent,
  };
}
