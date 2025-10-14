import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FocusEvent, TextareaHTMLAttributes } from "react";
import "prosemirror-view/style/prosemirror.css";
import { toggleMark, setBlockType, wrapIn } from "prosemirror-commands";
import { redo, redoDepth, undo, undoDepth } from "prosemirror-history";
import { wrapInList } from "prosemirror-schema-list";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import {
  countRawBlocks,
  createEditorSchema,
  parseMarkdoc,
  serializeMarkdoc,
} from "~/modules/editor-v2/markdoc-utils";
import { Logger } from "~/utils/logger";
import { tw } from "~/utils/tw";

import { BubbleMenu } from "./components/bubble-menu";
import { LinkDialog, RawBlockDialog } from "./components/dialogs";
import { SlashCommandMenu } from "./components/slash-command-menu";
import { EditorToolbar } from "./components/toolbar";
import {
  createHorizontalRuleCommand,
  createInputPlugins,
  createSlashCommands,
  EDITOR_BASE_CLASS,
  EDITOR_DISABLED_CLASS,
  filterSlashCommands,
  findLinkRange,
  getBlockFromState,
  markIsActive,
  placeholderPluginKey,
  sanitizeHref,
} from "./helpers";
import type {
  BubbleState,
  LinkDialogState,
  RawBlockDialogState,
  SlashCommandItem,
  SlashState,
  ToolbarBlock,
  ToolbarState,
} from "./types";

interface EditorV2Props
  extends Omit<
    TextareaHTMLAttributes<HTMLTextAreaElement>,
    "defaultValue" | "onChange"
  > {
  label: string;
  name: string;
  defaultValue: string;
  onChange?: (value: string) => void;
}

const INITIAL_TOOLBAR_STATE: ToolbarState = {
  block: "paragraph",
  bold: false,
  italic: false,
  code: false,
  link: false,
  canUndo: false,
  canRedo: false,
};

const HINT_TEXT = "Use / to access commands.";

export const EditorV2 = forwardRef<HTMLTextAreaElement, EditorV2Props>(
  function EditorV2(
    {
      defaultValue,
      label,
      name,
      placeholder,
      disabled,
      className,
      maxLength,
      onBlur,
      onFocus,
      onChange,
      ...textareaProps
    },
    ref
  ) {
    const { autoFocus: shouldAutoFocus, ...restTextareaProps } =
      textareaProps as typeof textareaProps & { autoFocus?: boolean };

    const schema = useMemo(() => createEditorSchema(), []);
    const editorContainerRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const hiddenTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const disabledRef = useRef(disabled);

    const [markdocValue, setMarkdocValue] = useState(defaultValue);
    const markdocValueRef = useRef(defaultValue);
    const [toolbarState, setToolbarState] = useState<ToolbarState>(
      INITIAL_TOOLBAR_STATE
    );
    const [bubbleState, setBubbleState] = useState<BubbleState>({
      visible: false,
      left: 0,
      top: 0,
    });
    const [slashState, setSlashState] = useState<SlashState | null>(null);
    const slashStateRef = useRef<SlashState | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
    const slashIndexRef = useRef(0);
    const filteredCommandsRef = useRef<SlashCommandItem[]>([]);
    const [linkDialog, setLinkDialog] = useState<LinkDialogState>({
      open: false,
      href: "",
      range: null,
    });
    const [rawBlockDialog, setRawBlockDialog] = useState<RawBlockDialogState>({
      open: false,
      raw: "",
      pos: null,
    });
    const rawBlockTelemetryRef = useRef<number>(0);

    disabledRef.current = disabled;

    const commands = useMemo(() => createSlashCommands(schema), [schema]);

    const applyToolbarState = useCallback((state: EditorState) => {
      const block = getBlockFromState(state);
      const bold = markIsActive(state, "strong");
      const italic = markIsActive(state, "em");
      const code = markIsActive(state, "code");
      const link = markIsActive(state, "link");
      const next: ToolbarState = {
        block,
        bold,
        italic,
        code,
        link,
        canUndo: undoDepth(state) > 0,
        canRedo: redoDepth(state) > 0,
      };
      setToolbarState(next);
    }, []);

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

    const updateSlash = useCallback(
      (state: EditorState, view: EditorView) => {
        if (!state.selection.empty) {
          setSlashState(null);
          slashStateRef.current = null;
          return;
        }
        const { $from } = state.selection;
        if (!$from || !$from.parent) {
          setSlashState(null);
          slashStateRef.current = null;
          return;
        }
        const textBefore = $from.parent.textBetween(
          0,
          $from.parentOffset,
          undefined,
          "\ufffc"
        );
        const slashIndex = textBefore.lastIndexOf("/");
        let from: number | null = null;
        let query = "";

        if (slashIndex !== -1) {
          const prefix = textBefore.slice(0, slashIndex);
          if (prefix && /[^\s]$/.test(prefix)) {
            setSlashState(null);
            slashStateRef.current = null;
            return;
          }
          query = textBefore.slice(slashIndex + 1);
          if (!/^[\w-]*$/.test(query)) {
            setSlashState(null);
            slashStateRef.current = null;
            return;
          }
          from = state.selection.from - query.length - 1;
        } else if (slashStateRef.current?.active) {
          from = slashStateRef.current.from;
          query = state.doc.textBetween(
            slashStateRef.current.from + 1,
            state.selection.from,
            undefined,
            "\ufffc"
          );
        }

        if (from == null || from < 0 || !Number.isFinite(from)) {
          setSlashState(null);
          slashStateRef.current = null;
          return;
        }

        const to = state.selection.from;
        const nextSlashState: SlashState = {
          active: true,
          query,
          from,
          to,
          left: 0,
          top: 0,
        };

        try {
          const coords = view.coordsAtPos(from);
          nextSlashState.left = coords.left;
          nextSlashState.top = coords.bottom + 6;
        } catch {
          const fallback = (view.dom as HTMLElement)?.getBoundingClientRect();
          nextSlashState.left = fallback?.left ?? 0;
          nextSlashState.top = (fallback?.bottom ?? 0) + 6;
        }

        setSlashIndex(0);
        slashIndexRef.current = 0;
        slashStateRef.current = nextSlashState;
        setSlashState(nextSlashState);
      },
      []
    );

    const runCommand = useCallback((command: any) => {
      const view = viewRef.current;
      if (!view) return;
      command(view.state, view.dispatch, view);
      view.focus();
    }, []);

    const handleParagraphChange = useCallback(
      (value: ToolbarBlock) => {
        const view = viewRef.current;
        if (!view) return;
        const { state } = view;
        switch (value) {
          case "paragraph":
            setBlockType(schema.nodes.paragraph)(state, view.dispatch, view);
            break;
          case "heading1":
          case "heading2":
          case "heading3":
          case "heading4": {
            const level = Number(value.replace("heading", ""));
            setBlockType(schema.nodes.heading, { level })(
              state,
              view.dispatch,
              view
            );
            break;
          }
          case "bullet_list":
            wrapInList(schema.nodes.bullet_list)(state, view.dispatch, view);
            break;
          case "ordered_list":
            wrapInList(schema.nodes.ordered_list)(state, view.dispatch, view);
            break;
          case "blockquote":
            wrapIn(schema.nodes.blockquote)(state, view.dispatch, view);
            break;
        }
        view.focus();
      },
      [
        schema.nodes.blockquote,
        schema.nodes.bullet_list,
        schema.nodes.heading,
        schema.nodes.ordered_list,
        schema.nodes.paragraph,
      ]
    );

    const openLinkDialog = useCallback(() => {
      const view = viewRef.current;
      if (!view) return;
      const { state } = view;
      const linkMark = schema.marks.link;
      if (!linkMark) return;

      const range = findLinkRange(state, linkMark);
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
    }, [schema.marks.link]);

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
    }, [closeLinkDialog, linkDialog.href, linkDialog.range, schema.marks.link]);

    const applySlashCommand = useCallback(
      (command: SlashCommandItem) => {
        const view = viewRef.current;
        if (!view || !slashState) return;
        const { from, to } = slashState;
        const { state } = view;
        const tr = state.tr.delete(from, to);
        view.dispatch(tr);
        command.command(view.state, view.dispatch, view);
        view.focus();
        setSlashState(null);
        setSlashIndex(0);
      },
      [slashState]
    );

    const openRawBlockEditor = useCallback((pos: number, raw: string) => {
      setRawBlockDialog({ open: true, pos, raw });
    }, []);

    const applyRawBlockEdit = useCallback(() => {
      const view = viewRef.current;
      if (!view || rawBlockDialog.pos == null) {
        setRawBlockDialog({ open: false, pos: null, raw: "" });
        return;
      }
      const { pos, raw } = rawBlockDialog;
      const node = view.state.doc.nodeAt(pos);
      if (!node || node.type.name !== "raw_block") {
        setRawBlockDialog({ open: false, pos: null, raw: "" });
        return;
      }
      const tr = view.state.tr.setNodeMarkup(pos, undefined, { raw });
      view.dispatch(tr);
      view.focus();
      setRawBlockDialog({ open: false, pos: null, raw: "" });
    }, [rawBlockDialog]);

    const handleSlashKeyDown = useCallback(
      (event: KeyboardEvent) => {
        const state = slashStateRef.current;
        const commandsList = filteredCommandsRef.current;
        if (!state?.active || commandsList.length === 0) {
          return false;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((index) => (index + 1) % commandsList.length);
          return true;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex((index) =>
            (index - 1 + commandsList.length) % commandsList.length
          );
          return true;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          const command =
            commandsList[slashIndexRef.current] ?? commandsList[0];
          if (command) {
            applySlashCommand(command);
          }
          return true;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          setSlashState(null);
          setSlashIndex(0);
          return true;
        }
        return false;
      },
      [applySlashCommand]
    );

    useImperativeHandle(ref, () => {
      const element = hiddenTextareaRef.current;
      if (!element) {
        return null as unknown as HTMLTextAreaElement;
      }
      return Object.assign(element, {
        focus: () => {
          if (viewRef.current) {
            viewRef.current.focus();
          } else {
            element.focus();
          }
        },
      });
    });

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
            ...createInputPlugins(schema, openLinkDialog),
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
            onChange?.(nextMarkdoc);
            const rawCount = countRawBlocks(nextState.doc);
            if (rawCount > 0 && rawCount !== rawBlockTelemetryRef.current) {
              Logger.info("editor-v2.raw-blocks", { count: rawCount });
            }
            rawBlockTelemetryRef.current = rawCount;
          }
          applyToolbarState(nextState);
          updateBubble(nextState, currentView);
          updateSlash(nextState, currentView);
        },
        nodeViews: {
          raw_block: (node, _view, getPos) => {
            const dom = document.createElement("div");
            dom.className =
              "relative rounded border border-dashed border-gray-300 bg-gray-50";
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
                openRawBlockEditor(resolvedPos, node.attrs.raw ?? "");
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
        handleDOMEvents: {
          focus: (_view, event) => {
            onFocus?.(event as unknown as FocusEvent<HTMLTextAreaElement>);
            return false;
          },
          blur: (_view, event) => {
            onBlur?.(event as unknown as FocusEvent<HTMLTextAreaElement>);
            return false;
          },
          keydown: (_view, event) => handleSlashKeyDown(event as KeyboardEvent),
        },
      });

      (view.state as any).placeholder = placeholder;
      viewRef.current = view;
      (container as any).__editorView = view;

      const initialValue = serializeMarkdoc(view.state.doc, schema);
      setMarkdocValue(initialValue);
      markdocValueRef.current = initialValue;
      applyToolbarState(view.state);
      updateBubble(view.state, view);
      updateSlash(view.state, view);

      if (shouldAutoFocus) {
        view.focus();
      }

      return () => {
        delete (container as any).__editorView;
        view.destroy();
        viewRef.current = null;
      };
    }, [
      applyToolbarState,
      defaultValue,
      handleSlashKeyDown,
      maxLength,
      onBlur,
      onChange,
      onFocus,
      openLinkDialog,
      openRawBlockEditor,
      placeholder,
      schema,
      shouldAutoFocus,
      updateBubble,
      updateSlash,
    ]);

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
    }, [disabled]);

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
    }, [defaultValue, schema]);

    useEffect(() => {
      if (!slashState) {
        setSlashIndex(0);
      }
      slashStateRef.current = slashState;
    }, [slashState]);

    useEffect(() => {
      slashIndexRef.current = slashIndex;
    }, [slashIndex]);

    const filteredCommands = useMemo(
      () => filterSlashCommands(commands, slashState?.query ?? ""),
      [commands, slashState]
    );

    useEffect(() => {
      filteredCommandsRef.current = filteredCommands;
    }, [filteredCommands]);

    useEffect(() => {
      if (hiddenTextareaRef.current) {
        hiddenTextareaRef.current.value = markdocValue;
      }
    }, [markdocValue]);

    useLayoutEffect(() => {
      if (shouldAutoFocus && viewRef.current) {
        viewRef.current.focus();
      }
    }, [shouldAutoFocus]);

    return (
      <div className={tw("flex flex-col gap-2", className)}>
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="border-b border-gray-100 bg-white px-3 py-2">
            <EditorToolbar
              state={toolbarState}
              onUndo={() => runCommand(undo)}
              onRedo={() => runCommand(redo)}
              onParagraphChange={handleParagraphChange}
              onBold={() => runCommand(toggleMark(schema.marks.strong))}
              onItalic={() => runCommand(toggleMark(schema.marks.em))}
              onToggleLink={openLinkDialog}
              onBulletList={() => runCommand(wrapInList(schema.nodes.bullet_list))}
              onOrderedList={() =>
                runCommand(wrapInList(schema.nodes.ordered_list))
              }
              onQuote={() => runCommand(wrapIn(schema.nodes.blockquote))}
              onDivider={
                schema.nodes.horizontal_rule
                  ? () => runCommand(createHorizontalRuleCommand(schema))
                  : undefined
              }
              hasDivider={Boolean(schema.nodes.horizontal_rule)}
            />
          </div>
          <div
            className="relative bg-gray-50 px-3 py-4 focus-within:ring-2 focus-within:ring-gray-300"
            onMouseDown={(event) => {
              if (!(event.target instanceof HTMLElement)) {
                return;
              }
              if (event.target.closest('[contenteditable="true"]')) {
                return;
              }
              event.preventDefault();
              viewRef.current?.focus();
            }}
          >
            <div
              ref={editorContainerRef}
              className="min-h-[200px]"
              data-testid="editor-v2-content"
              onMouseDown={(event) => {
                if (!(event.target instanceof HTMLElement)) {
                  return;
                }
                if (event.target.closest('[contenteditable="true"]')) {
                  return;
                }
                event.preventDefault();
                viewRef.current?.focus();
              }}
            />
            <BubbleMenu
              state={bubbleState}
              onBold={() => runCommand(toggleMark(schema.marks.strong))}
              onItalic={() => runCommand(toggleMark(schema.marks.em))}
              onLink={openLinkDialog}
              boldActive={toolbarState.bold}
              italicActive={toolbarState.italic}
              linkActive={toolbarState.link}
            />
            <SlashCommandMenu
              state={slashState}
              commands={filteredCommands}
              selectedIndex={slashIndex}
              onSelect={setSlashIndex}
              onRun={applySlashCommand}
            />
          </div>
        </div>
        <textarea
          ref={hiddenTextareaRef}
          name={name}
          value={markdocValue}
          readOnly
          hidden
          disabled={disabled}
          aria-hidden="true"
          data-testid="editor-v2-input"
          {...restTextareaProps}
        />
        <div className="flex flex-col gap-1 text-xs text-gray-500">
          <span>{label} supports Markdown and Markdoc. {HINT_TEXT}</span>
          {maxLength ? (
            <span
              className={
                markdocValue.length > maxLength ? "text-error-600" : undefined
              }
            >
              {markdocValue.length}/{maxLength}
            </span>
          ) : null}
        </div>
        <LinkDialog
          state={linkDialog}
          onClose={closeLinkDialog}
          onHrefChange={(href) =>
            setLinkDialog((state) => ({ ...state, href }))
          }
          onApply={applyLink}
        />
        <RawBlockDialog
          state={rawBlockDialog}
          onClose={() =>
            setRawBlockDialog({ open: false, raw: "", pos: null })
          }
          onChange={(raw) =>
            setRawBlockDialog((state) => ({ ...state, raw }))
          }
          onSave={applyRawBlockEdit}
        />
      </div>
    );
  }
);
