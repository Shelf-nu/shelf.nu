import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, TextareaHTMLAttributes } from "react";
import "prosemirror-view/style/prosemirror.css";
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
} from "prosemirror-commands";
import { history, redo, undo, redoDepth, undoDepth } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { Schema } from "prosemirror-model";
import {
  wrapInList,
  liftListItem,
  sinkListItem,
} from "prosemirror-schema-list";
import { EditorState, Plugin } from "prosemirror-state";
import type { Command as PMCommand } from "prosemirror-state";
import { EditorView, Decoration, DecorationSet } from "prosemirror-view";
import {
  countRawBlocks,
  createEditorSchema,
  parseMarkdoc,
  serializeMarkdoc,
} from "~/modules/editor-v2/markdoc-utils";
import { Logger } from "~/utils/logger";
import { tw } from "~/utils/tw";
import { Button } from "../shared/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../shared/modal";

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

type ToolbarBlock =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "bullet_list"
  | "ordered_list"
  | "blockquote"
  | "raw_block";

interface ToolbarState {
  block: ToolbarBlock;
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

interface BubbleState {
  visible: boolean;
  left: number;
  top: number;
}

interface SlashState {
  active: boolean;
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
}

interface LinkDialogState {
  open: boolean;
  href: string;
  range: { from: number; to: number } | null;
}

interface RawBlockDialogState {
  open: boolean;
  raw: string;
  pos: number | null;
}

interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  command: PMCommand;
}

const EDITOR_BASE_CLASS = "prose prose-sm max-w-none focus:outline-none";
const EDITOR_DISABLED_CLASS = "pointer-events-none opacity-60";

const placeholderPluginKey = new Plugin({
  props: {
    decorations(state) {
      const placeholder = (state as any).placeholder as string | undefined;
      if (!placeholder) {
        return null;
      }
      const docIsEmpty =
        state.doc.childCount === 1 &&
        state.doc.firstChild?.type.name === "paragraph" &&
        state.doc.firstChild.childCount === 0;
      if (!docIsEmpty) {
        return null;
      }
      const deco = Decoration.widget(1, () => {
        const span = document.createElement("span");
        span.className = "pointer-events-none text-sm text-gray-400";
        span.textContent = placeholder;
        return span;
      });
      return DecorationSet.create(state.doc, [deco]);
    },
  },
}) as Plugin & {
  props: {
    decorations: (
      state: EditorState & { placeholder?: string }
    ) => DecorationSet | null;
  };
};

function createInputRules(schema: Schema) {
  const rules = [
    textblockTypeInputRule(/^(#{1,4})\s$/, schema.nodes.heading, (match) => ({
      level: match[1].length,
    })),
    wrappingInputRule(/^>\s$/, schema.nodes.blockquote),
    wrappingInputRule(/^[*-]\s$/, schema.nodes.bullet_list),
    wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, (match) => ({
      order: Number.parseInt(match[1], 10),
    })),
  ];

  if (schema.nodes.horizontal_rule) {
    const horizontalRule = schema.nodes.horizontal_rule;
    rules.push(
      new InputRule(/^---$/, (state, _match, start, end) => {
        const { tr } = state;
        const from = Math.max(0, start - 1);
        return tr.replaceWith(from, end, horizontalRule.create());
      })
    );
  }

  return [...smartQuotes, ...rules];
}

function markIsActive(state: EditorState, mark: string) {
  const { from, $from, to, empty } = state.selection;
  if (empty) {
    return (
      (!!mark &&
        !!state.storedMarks?.some((stored) => stored.type.name === mark)) ||
      $from.marks().some((stored) => stored.type.name === mark)
    );
  }
  return state.doc.rangeHasMark(from, to, state.schema.marks[mark]);
}

function getBlockFromState(state: EditorState): ToolbarBlock {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name === "bullet_list") {
      return "bullet_list";
    }
    if (node.type.name === "ordered_list") {
      return "ordered_list";
    }
    if (node.type.name === "blockquote") {
      return "blockquote";
    }
  }

  const parent = $from.parent;
  if (parent.type.name === "heading") {
    const level = Math.min(Math.max(parent.attrs.level ?? 1, 1), 4);
    return `heading${level}` as ToolbarBlock;
  }
  if (parent.type.name === "raw_block") {
    return "raw_block";
  }
  return "paragraph";
}

function createHorizontalRuleCommand(schema: Schema): PMCommand {
  return (state, dispatch) => {
    const hr = schema.nodes.horizontal_rule;
    if (!hr) return false;
    if (dispatch) {
      const tr = state.tr.replaceSelectionWith(hr.create());
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function sanitizeHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]); // minimal allow list

  try {
    const hasProtocol = /^[a-z]+:/i.test(trimmed);
    const url = new URL(hasProtocol ? trimmed : `https://${trimmed}`);
    if (!allowedProtocols.has(url.protocol)) {
      return "";
    }
    if (
      !hasProtocol &&
      (url.protocol === "http:" || url.protocol === "https:")
    ) {
      return url.href;
    }
    return trimmed;
  } catch {
    return "";
  }
}

function buildKeymap(schema: Schema, openLinkDialog: () => void) {
  const hardBreak = (state: EditorState, dispatch?: (tr: any) => void) => {
    const br = schema.nodes.hard_break;
    if (!br) return false;
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(br.create()).scrollIntoView());
    }
    return true;
  };

  const linkCommand: PMCommand = () => {
    openLinkDialog();
    return true;
  };

  return {
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-B": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
    "Mod-I": toggleMark(schema.marks.em),
    "Mod-k": linkCommand,
    "Mod-K": linkCommand,
    "Shift-Enter": hardBreak,
    "Mod-z": undo,
    "Mod-y": redo,
    "Mod-Shift-z": redo,
    Tab: (state, dispatch, view) =>
      sinkListItem(schema.nodes.list_item)(state, dispatch, view),
    "Shift-Tab": liftListItem(schema.nodes.list_item),
  } as Record<string, PMCommand>;
}

function createSlashCommands(schema: Schema): SlashCommandItem[] {
  const heading = schema.nodes.heading;
  const paragraph = schema.nodes.paragraph;
  const blockquote = schema.nodes.blockquote;
  const bullet = schema.nodes.bullet_list;
  const ordered = schema.nodes.ordered_list;
  const hr = schema.nodes.horizontal_rule;

  const commands: SlashCommandItem[] = [
    {
      id: "paragraph",
      label: "Paragraph",
      description: "Start with plain text",
      aliases: ["p"],
      command: setBlockType(paragraph),
    },
    {
      id: "h1",
      label: "Heading 1",
      description: "Large section heading",
      aliases: ["heading1", "title"],
      command: setBlockType(heading, { level: 1 }),
    },
    {
      id: "h2",
      label: "Heading 2",
      description: "Medium section heading",
      aliases: ["heading2"],
      command: setBlockType(heading, { level: 2 }),
    },
    {
      id: "h3",
      label: "Heading 3",
      description: "Small section heading",
      aliases: ["heading3"],
      command: setBlockType(heading, { level: 3 }),
    },
    {
      id: "h4",
      label: "Heading 4",
      description: "Minor section heading",
      aliases: ["heading4"],
      command: setBlockType(heading, { level: 4 }),
    },
    {
      id: "bullet-list",
      label: "Bullet list",
      description: "Create a bulleted list",
      aliases: ["ul", "bullet"],
      command: wrapInList(bullet),
    },
    {
      id: "ordered-list",
      label: "Numbered list",
      description: "Create a numbered list",
      aliases: ["ol", "number"],
      command: wrapInList(ordered),
    },
    {
      id: "blockquote",
      label: "Quote",
      description: "Emphasize with a quote block",
      aliases: ["quote"],
      command: wrapIn(blockquote),
    },
  ];

  if (hr) {
    commands.push({
      id: "divider",
      label: "Divider",
      description: "Insert a horizontal rule",
      aliases: ["divider", "hr"],
      command: createHorizontalRuleCommand(schema),
    });
  }

  return commands;
}

function filterSlashCommands(commands: SlashCommandItem[], query: string) {
  if (!query) {
    return commands;
  }
  const normalized = query.toLowerCase();
  return commands.filter((command) => {
    if (command.label.toLowerCase().includes(normalized)) {
      return true;
    }
    return command.aliases.some((alias) =>
      alias.toLowerCase().includes(normalized)
    );
  });
}

interface ToolbarButtonProps {
  label: string;
  icon?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}

function ToolbarButton({
  label,
  onClick,
  active,
  disabled,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={tw(
        "inline-flex h-9 items-center justify-center rounded px-2 text-sm font-medium transition",
        active
          ? "bg-primary-50 text-primary-700"
          : "text-gray-600 hover:bg-gray-100",
        disabled ? "cursor-not-allowed opacity-40" : ""
      )}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

interface ParagraphSelectProps {
  value: ToolbarBlock;
  onChange: (value: ToolbarBlock) => void;
}

function ParagraphSelect({ value, onChange }: ParagraphSelectProps) {
  const normalized = value === "raw_block" ? "paragraph" : value;
  return (
    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
      <span className="sr-only">Paragraph style</span>
      <select
        className="h-9 rounded border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
        aria-label="Paragraph style"
        value={normalized}
        onChange={(event) => onChange(event.target.value as ToolbarBlock)}
        disabled={value === "raw_block"}
      >
        <option value="paragraph">Paragraph</option>
        <option value="heading1">Heading 1</option>
        <option value="heading2">Heading 2</option>
        <option value="heading3">Heading 3</option>
        <option value="heading4">Heading 4</option>
        <option value="bullet_list">Bullet list</option>
        <option value="ordered_list">Numbered list</option>
        <option value="blockquote">Quote</option>
      </select>
    </label>
  );
}

interface SlashCommandMenuProps {
  state: SlashState | null;
  commands: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onRun: (command: SlashCommandItem) => void;
}

function SlashCommandMenu({
  state,
  commands,
  selectedIndex,
  onSelect,
  onRun,
}: SlashCommandMenuProps) {
  if (!state || !state.active || commands.length === 0) {
    return null;
  }
  return (
    <div
      className="fixed z-50 w-64 overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl"
      style={{ left: state.left, top: state.top }}
      role="listbox"
      aria-label="Slash command menu"
    >
      <ul className="max-h-64 overflow-y-auto">
        {commands.map((command, index) => (
          <li key={command.id}>
            <button
              type="button"
              role="option"
              aria-selected={selectedIndex === index}
              className={tw(
                "block w-full px-3 py-2 text-left text-sm",
                selectedIndex === index
                  ? "bg-primary-50 text-primary-700"
                  : "hover:bg-gray-50"
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRun(command)}
              onMouseEnter={() => onSelect(index)}
            >
              <div className="font-medium">{command.label}</div>
              <div className="text-xs text-gray-500">{command.description}</div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface BubbleMenuProps {
  state: BubbleState;
  onBold: () => void;
  onItalic: () => void;
  onLink: () => void;
  boldActive: boolean;
  italicActive: boolean;
}

function BubbleMenu({
  state,
  onBold,
  onItalic,
  onLink,
  boldActive,
  italicActive,
}: BubbleMenuProps) {
  if (!state.visible) {
    return null;
  }
  return (
    <div
      className="fixed z-50 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 shadow-lg"
      style={{ left: state.left, top: state.top }}
      role="toolbar"
      aria-label="Inline formatting"
    >
      <ToolbarButton label="Bold" active={boldActive} onClick={onBold} />
      <ToolbarButton label="Italic" active={italicActive} onClick={onItalic} />
      <ToolbarButton label="Link" onClick={onLink} />
    </div>
  );
}

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
    const [markdocValue, setMarkdocValue] = useState(defaultValue);
    const markdocValueRef = useRef(defaultValue);
    const [toolbarState, setToolbarState] = useState<ToolbarState>(() => ({
      block: "paragraph",
      bold: false,
      italic: false,
      code: false,
      link: false,
      canUndo: false,
      canRedo: false,
    }));
    const [bubbleState, setBubbleState] = useState<BubbleState>({
      visible: false,
      left: 0,
      top: 0,
    });
    const [slashState, setSlashState] = useState<SlashState | null>(null);
    const [slashIndex, setSlashIndex] = useState(0);
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

    const updateSlash = useCallback((state: EditorState, view: EditorView) => {
      if (!state.selection.empty) {
        setSlashState(null);
        return;
      }
      const { $from } = state.selection;
      if (!$from || !$from.parent) {
        setSlashState(null);
        return;
      }
      const textBefore = $from.parent.textBetween(
        0,
        $from.parentOffset,
        undefined,
        "\ufffc"
      );
      const slashIndex = textBefore.lastIndexOf("/");
      if (slashIndex === -1) {
        setSlashState(null);
        return;
      }
      const prefix = textBefore.slice(0, slashIndex);
      if (prefix && /[^\s]$/.test(prefix)) {
        setSlashState(null);
        return;
      }
      const query = textBefore.slice(slashIndex + 1);
      if (!/^[\w-]*$/.test(query)) {
        setSlashState(null);
        return;
      }
      const from = state.selection.from - query.length - 1;
      const to = state.selection.from;
      try {
        const coords = view.coordsAtPos(from);
        setSlashState({
          active: true,
          query,
          from,
          to,
          left: coords.left,
          top: coords.bottom + 6,
        });
      } catch {
        setSlashState(null);
      }
    }, []);

    const runCommand = useCallback((command: PMCommand) => {
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
      const { from, to } = state.selection;
      if (from === to) {
        return;
      }
      const linkMark = schema.marks.link;
      let href = "";
      state.doc.nodesBetween(from, to, (node) => {
        const marks = node.marks || [];
        const mark = marks.find((m) => m.type === linkMark);
        if (mark) {
          href = mark.attrs.href || "";
          return false;
        }
        return true;
      });
      setLinkDialog({ open: true, href, range: { from, to } });
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
      view.dispatch(
        href
          ? state.tr
              .addMark(from, to, linkMark.create({ href }))
              .scrollIntoView()
          : state.tr.removeMark(from, to, linkMark).scrollIntoView()
      );
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

    useEffect(() => {
      if (!editorContainerRef.current) {
        return;
      }
      const container = editorContainerRef.current;
      const initialDoc = parseMarkdoc(defaultValue, schema);

      const view = new EditorView(container, {
        state: EditorState.create({
          schema,
          doc: initialDoc,
          plugins: [
            history(),
            inputRules({ rules: createInputRules(schema) }),
            keymap(buildKeymap(schema, openLinkDialog)),
            keymap(baseKeymap),
            placeholderPluginKey,
          ],
        }) as EditorState & { placeholder?: string },
        attributes: {
          class: tw(EDITOR_BASE_CLASS),
        },
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
        editable: () => true,
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

      const dom = view.dom as HTMLElement;
      const handleFocus = (event: FocusEvent) => onFocus?.(event as any);
      const handleBlur = (event: FocusEvent) => onBlur?.(event as any);
      dom.addEventListener("focus", handleFocus);
      dom.addEventListener("blur", handleBlur);

      return () => {
        dom.removeEventListener("focus", handleFocus);
        dom.removeEventListener("blur", handleBlur);
        delete (container as any).__editorView;
        view.destroy();
        viewRef.current = null;
      };
    }, [
      applyToolbarState,
      defaultValue,
      maxLength,
      onBlur,
      onChange,
      onFocus,
      openLinkDialog,
      openRawBlockEditor,
      placeholder,
      schema,
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
        disabled ? EDITOR_DISABLED_CLASS : ""
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
      const view = viewRef.current;
      if (!view) return;
      const handleKeyDown = (event: KeyboardEvent) => {
        if (!slashState || !slashState.active) {
          return;
        }
        const filtered = filterSlashCommands(commands, slashState.query);
        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSlashIndex((index) => (index + 1) % Math.max(filtered.length, 1));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashIndex(
            (index) =>
              (index - 1 + filtered.length) % Math.max(filtered.length, 1)
          );
        } else if (event.key === "Enter") {
          event.preventDefault();
          const command = filtered[slashIndex] ?? filtered[0];
          if (command) {
            applySlashCommand(command);
          }
        } else if (event.key === "Escape") {
          event.preventDefault();
          setSlashState(null);
        }
      };
      const dom = view.dom as HTMLElement;
      dom.addEventListener("keydown", handleKeyDown);
      return () => {
        dom.removeEventListener("keydown", handleKeyDown);
      };
    }, [applySlashCommand, commands, slashIndex, slashState]);

    useEffect(() => {
      if (!slashState) {
        setSlashIndex(0);
      }
    }, [slashState]);

    useEffect(() => {
      if (shouldAutoFocus && viewRef.current) {
        viewRef.current.focus();
      }
    }, [shouldAutoFocus]);

    const filteredCommands = useMemo(
      () => filterSlashCommands(commands, slashState?.query ?? ""),
      [commands, slashState]
    );

    return (
      <div className={tw("flex flex-col gap-2", className)}>
        <div className="flex flex-col gap-2 rounded border border-gray-200 bg-white p-3">
          <div
            className="flex flex-wrap items-center gap-2"
            role="toolbar"
            aria-label="Editor formatting toolbar"
          >
            <ToolbarButton
              label="Undo"
              onClick={() => runCommand(undo)}
              disabled={!toolbarState.canUndo}
            />
            <ToolbarButton
              label="Redo"
              onClick={() => runCommand(redo)}
              disabled={!toolbarState.canRedo}
            />
            <ParagraphSelect
              value={toolbarState.block}
              onChange={handleParagraphChange}
            />
            <ToolbarButton
              label="Bold"
              active={toolbarState.bold}
              onClick={() => runCommand(toggleMark(schema.marks.strong))}
            />
            <ToolbarButton
              label="Italic"
              active={toolbarState.italic}
              onClick={() => runCommand(toggleMark(schema.marks.em))}
            />
            <ToolbarButton label="Link" onClick={openLinkDialog} />
            <ToolbarButton
              label="Bulleted list"
              active={toolbarState.block === "bullet_list"}
              onClick={() => runCommand(wrapInList(schema.nodes.bullet_list))}
            />
            <ToolbarButton
              label="Numbered list"
              active={toolbarState.block === "ordered_list"}
              onClick={() => runCommand(wrapInList(schema.nodes.ordered_list))}
            />
            <ToolbarButton
              label="Quote"
              active={toolbarState.block === "blockquote"}
              onClick={() => runCommand(wrapIn(schema.nodes.blockquote))}
            />
            {schema.nodes.horizontal_rule ? (
              <ToolbarButton
                label="Divider"
                onClick={() => runCommand(createHorizontalRuleCommand(schema))}
              />
            ) : null}
          </div>
          <div className="relative">
            <div
              ref={editorContainerRef}
              className="min-h-[200px] cursor-text px-2 py-3"
              data-testid="editor-v2-content"
            />
            <BubbleMenu
              state={bubbleState}
              onBold={() => runCommand(toggleMark(schema.marks.strong))}
              onItalic={() => runCommand(toggleMark(schema.marks.em))}
              onLink={openLinkDialog}
              boldActive={toolbarState.bold}
              italicActive={toolbarState.italic}
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
          ref={ref}
          name={name}
          value={markdocValue}
          readOnly
          hidden
          disabled={disabled}
          aria-hidden="true"
          data-testid="editor-v2-input"
          {...restTextareaProps}
        />
        {maxLength ? (
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>
              {label} supports Markdown and Markdoc. Use / to access commands.
            </span>
            <span
              className={
                markdocValue.length > maxLength ? "text-error-600" : ""
              }
            >
              {markdocValue.length}/{maxLength}
            </span>
          </div>
        ) : null}
        <AlertDialog
          open={linkDialog.open}
          onOpenChange={(open) => (open ? null : closeLinkDialog())}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Edit link</AlertDialogTitle>
              <AlertDialogDescription>
                Enter the URL for the selected text.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                URL
                <input
                  type="url"
                  value={linkDialog.href}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setLinkDialog((state) => ({
                      ...state,
                      href: event.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  placeholder="https://example.com"
                />
              </label>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="secondary" type="button">
                  Cancel
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button type="button" onClick={applyLink}>
                  Apply
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={rawBlockDialog.open}
          onOpenChange={(open) =>
            open ? null : setRawBlockDialog({ open: false, raw: "", pos: null })
          }
        >
          <AlertDialogContent className="max-w-2xl">
            <AlertDialogHeader>
              <AlertDialogTitle>Edit raw Markdoc block</AlertDialogTitle>
              <AlertDialogDescription>
                Unsupported Markdoc content is preserved as raw blocks. Updating
                the source will replace the block contents.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3">
              <textarea
                className="h-48 w-full rounded border border-gray-300 p-2 font-mono text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
                value={rawBlockDialog.raw}
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setRawBlockDialog((state) => ({
                    ...state,
                    raw: event.target.value,
                  }))
                }
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="secondary" type="button">
                  Cancel
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button type="button" onClick={applyRawBlockEdit}>
                  Save raw block
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }
);
