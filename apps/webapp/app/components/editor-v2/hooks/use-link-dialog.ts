import type { RefObject } from "react";
import { useCallback, useState } from "react";
import type { Schema } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";

import { findLinkRange, sanitizeHref } from "../helpers";
import type { LinkDialogState } from "../types";

export function useLinkDialog(
  schema: Schema,
  viewRef: RefObject<EditorView | null>
) {
  const [linkDialog, setLinkDialog] = useState<LinkDialogState>({
    open: false,
    href: "",
    range: null,
  });

  const openLinkDialog = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { state } = view;
    const linkMark = schema.marks.link;
    if (!linkMark) return;

    const { from, to } = state.selection;
    const range = from !== to ? { from, to } : findLinkRange(state, linkMark);
    if (!range) {
      return;
    }

    let href = "";
    state.doc.nodesBetween(range.from, range.to, (node) => {
      const mark = node.marks?.find((m) => m.type === linkMark);
      if (mark) {
        href = mark.attrs.href || "";
        return false;
      }
      return true;
    });

    setLinkDialog({ open: true, href, range });
  }, [schema.marks.link, viewRef]);

  const closeLinkDialog = useCallback(() => {
    setLinkDialog({ open: false, href: "", range: null });
  }, []);

  const applyLink = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    if (!linkDialog.range) {
      closeLinkDialog();
      return;
    }
    const href = sanitizeHref(linkDialog.href);
    const { from, to } = linkDialog.range;
    const { state } = view;
    const linkMark = schema.marks.link;
    let tr = state.tr;
    if (href) {
      tr = tr.addMark(from, to, linkMark.create({ href }));
    } else {
      tr = tr.removeMark(from, to, linkMark);
    }
    view.dispatch(tr.scrollIntoView());
    closeLinkDialog();
    view.focus();
  }, [
    closeLinkDialog,
    linkDialog.href,
    linkDialog.range,
    schema.marks.link,
    viewRef,
  ]);

  const setLinkHref = useCallback((href: string) => {
    setLinkDialog((state) => ({ ...state, href }));
  }, []);

  return {
    linkDialog,
    openLinkDialog,
    closeLinkDialog,
    applyLink,
    setLinkHref,
  };
}
