import { useEffect, useRef, useState } from "react";
import type { FocusEvent, MutableRefObject, RefObject } from "react";
import type { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import type { Slice } from "prosemirror-model";
import {
  countRawBlocks,
  parseMarkdoc,
  serializeMarkdoc,
} from "~/modules/editor-v2/markdoc-utils";
import { Logger } from "~/utils/logger";
import { tw } from "~/utils/tw";

import {
  createInputPlugins,
  EDITOR_BASE_CLASS,
  EDITOR_DISABLED_CLASS,
  placeholderPluginKey,
} from "../helpers";

interface UseEditorViewOptions {
  schema: Schema;
  defaultValue: string;
  disabled?: boolean;
  placeholder?: string;
  maxLength?: number;
  shouldAutoFocus?: boolean;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onChange?: (value: string) => void;
  onStateUpdate?: (state: EditorState, view: EditorView) => void;
  onKeyDown?: (event: KeyboardEvent) => boolean;
  openLinkDialog: () => void;
  openRawBlockEditor: (pos: number, raw: string) => void;
}

export function useEditorView(
  editorContainerRef: RefObject<HTMLDivElement | null>,
  viewRef: MutableRefObject<EditorView | null>,
  options: UseEditorViewOptions
) {
  const {
    schema,
    defaultValue,
    disabled,
    placeholder,
    maxLength,
    shouldAutoFocus,
    onBlur,
    onFocus,
    onChange,
    onStateUpdate,
    onKeyDown,
    openLinkDialog,
    openRawBlockEditor,
  } = options;

  const disabledRef = useRef(disabled);
  const [markdocValue, setMarkdocValue] = useState(defaultValue);
  const markdocValueRef = useRef(defaultValue);
  const rawBlockTelemetryRef = useRef<number>(0);

  // Store callbacks in refs to avoid re-initializing the editor
  const onStateUpdateRef = useRef(onStateUpdate);
  const onKeyDownRef = useRef(onKeyDown);
  const openLinkDialogRef = useRef(openLinkDialog);
  const openRawBlockEditorRef = useRef(openRawBlockEditor);
  const onBlurRef = useRef(onBlur);
  const onFocusRef = useRef(onFocus);
  const onChangeRef = useRef(onChange);

  disabledRef.current = disabled;
  onStateUpdateRef.current = onStateUpdate;
  onKeyDownRef.current = onKeyDown;
  openLinkDialogRef.current = openLinkDialog;
  openRawBlockEditorRef.current = openRawBlockEditor;
  onBlurRef.current = onBlur;
  onFocusRef.current = onFocus;
  onChangeRef.current = onChange;

  // Initialize editor view
  useEffect(() => {
    if (!editorContainerRef.current) {
      return;
    }
    const container = editorContainerRef.current;
    const initialDoc = parseMarkdoc(defaultValue, schema);
    const isDisabled = disabledRef.current;

    const view = new EditorView(container, {
      state: EditorState.create({
        schema,
        doc: initialDoc,
        plugins: [
          ...createInputPlugins(schema, () => openLinkDialogRef.current()),
          placeholderPluginKey,
        ],
      }) as EditorState & { placeholder?: string },
      attributes: {
        class: tw(
          EDITOR_BASE_CLASS,
          isDisabled ? EDITOR_DISABLED_CLASS : "",
          "cursor-text"
        ),
      },
      editable: () => !disabledRef.current,
      dispatchTransaction: (tr) => {
        const currentView = (viewRef.current ?? view) as EditorView;
        const nextState = currentView.state.apply(tr);
        let nextMarkdoc = markdocValueRef.current;
        if (tr.docChanged) {
          nextMarkdoc = serializeMarkdoc(nextState.doc, schema);
          if (maxLength && nextMarkdoc.length > maxLength) {
            return;
          }
        }
        currentView.updateState(nextState);
        if (tr.docChanged) {
          setMarkdocValue(nextMarkdoc);
          markdocValueRef.current = nextMarkdoc;
          onChangeRef.current?.(nextMarkdoc);
          const rawCount = countRawBlocks(nextState.doc);
          if (rawCount > 0 && rawCount !== rawBlockTelemetryRef.current) {
            Logger.info("editor-v2.raw-blocks", { count: rawCount });
          }
          rawBlockTelemetryRef.current = rawCount;
        }
        onStateUpdateRef.current?.(nextState, currentView);
      },
      nodeViews: {
        raw_block: (node, _view, getPos) => {
          const dom = document.createElement("div");
          dom.className =
            "raw-block relative rounded border border-dashed border-gray-300 bg-gray-50";
          const pre = document.createElement("pre");
          pre.className =
            "overflow-x-auto whitespace-pre-wrap p-3 text-xs font-mono text-gray-700";
          pre.textContent = node.attrs.raw ?? "";
          dom.appendChild(pre);
          const button = document.createElement("button");
          button.type = "button";
          button.className =
            "absolute right-3 top-3 rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 shadow-sm hover:bg-gray-100";
          button.textContent = "Edit source";
          button.addEventListener("mousedown", (event) =>
            event.preventDefault()
          );
          button.addEventListener("click", () => {
            const resolvedPos =
              typeof getPos === "function" ? getPos() : getPos;
            if (typeof resolvedPos === "number") {
              openRawBlockEditorRef.current(resolvedPos, node.attrs.raw ?? "");
            }
          });
          dom.appendChild(button);
          return {
            dom,
            update(updatedNode) {
              if (updatedNode.type !== node.type) {
                return false;
              }
              pre.textContent = updatedNode.attrs.raw ?? "";
              return true;
            },
          };
        },
      },
      handlePaste: (view, event) => {
        const text = event.clipboardData?.getData("text/plain");
        if (!text) return false;

        // Check if the pasted text contains markdown syntax
        const hasMarkdown =
          /(?:^#{1,4}\s|^[*-]\s|^>\s|^(\d+)\.\s|\*\*.+\*\*|__.+__|\[.+\]\(.+\))/m.test(
            text
          );
        if (!hasMarkdown) return false;

        // Parse the pasted markdown into ProseMirror nodes
        const doc = parseMarkdoc(text, schema);
        const slice = doc.slice(0, doc.content.size);
        const tr = view.state.tr.replaceSelection(slice);
        view.dispatch(tr.scrollIntoView());
        return true;
      },
      handleDOMEvents: {
        focus: (_view, event) => {
          onFocusRef.current?.(
            event as unknown as FocusEvent<HTMLTextAreaElement>
          );
          return false;
        },
        blur: (_view, event) => {
          onBlurRef.current?.(
            event as unknown as FocusEvent<HTMLTextAreaElement>
          );
          return false;
        },
        keydown: (_view, event) => {
          const keyboardEvent = event as KeyboardEvent;
          keyboardEvent.stopPropagation();
          if (onKeyDownRef.current?.(keyboardEvent)) {
            keyboardEvent.preventDefault();
            return true;
          }
          return false;
        },
      },
    });

    (view.state as any).placeholder = placeholder;
    viewRef.current = view;
    (container as any).__editorView = view;

    const initialValue = serializeMarkdoc(view.state.doc, schema);
    setMarkdocValue(initialValue);
    markdocValueRef.current = initialValue;
    onStateUpdateRef.current?.(view.state, view);

    // Only autofocus on desktop (mobile browsers often block programmatic focus)
    if (shouldAutoFocus) {
      const isMobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent
        );
      if (!isMobile) {
        view.focus();
      }
    }

    return () => {
      delete (container as any).__editorView;
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue, maxLength, placeholder, schema, shouldAutoFocus]);

  // Update disabled state
  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    const nextClass = tw(
      EDITOR_BASE_CLASS,
      disabled ? EDITOR_DISABLED_CLASS : "",
      "cursor-text"
    );
    view.setProps({
      editable: () => !disabled,
      attributes: { class: nextClass },
    });
    const dom = view.dom as HTMLElement;
    dom.className = nextClass;
    if (disabled) {
      dom.setAttribute("aria-disabled", "true");
    } else {
      dom.removeAttribute("aria-disabled");
    }
  }, [disabled, viewRef]);

  // Update content when defaultValue changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = parseMarkdoc(defaultValue, schema);
    const tr = view.state.tr.replaceWith(
      0,
      view.state.doc.content.size,
      doc.content
    );
    view.dispatch(tr);
  }, [defaultValue, schema, viewRef]);

  return {
    markdocValue,
  };
}
