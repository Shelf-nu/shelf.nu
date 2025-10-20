import { toggleMark, setBlockType, wrapIn, baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import {
  InputRule,
  inputRules,
  smartQuotes,
  textblockTypeInputRule,
  wrappingInputRule,
} from "prosemirror-inputrules";
import { keymap } from "prosemirror-keymap";
import type { MarkType, Schema } from "prosemirror-model";
import { wrapInList, liftListItem, sinkListItem, splitListItem } from "prosemirror-schema-list";
import { Plugin } from "prosemirror-state";
import type { Command as PMCommand, EditorState } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import type { SlashCommandItem, ToolbarBlock } from "./types";

export const EDITOR_BASE_CLASS =
  "pm-doc pm--editing max-w-none min-h-[200px] bg-transparent";
export const EDITOR_DISABLED_CLASS = "pointer-events-none opacity-60";

export const placeholderPluginKey = new Plugin({
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

export function createInputRules(schema: Schema) {
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

export function markIsActive(state: EditorState, mark: string) {
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

export function getBlockFromState(state: EditorState): ToolbarBlock {
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

export function createHorizontalRuleCommand(schema: Schema): PMCommand {
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

export function sanitizeHref(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const allowedProtocols = new Set(["http:", "https:", "mailto:", "tel:"]);

  try {
    const hasProtocol = /^[a-z]+:/i.test(trimmed);
    const url = new URL(hasProtocol ? trimmed : `https://${trimmed}`);
    if (!allowedProtocols.has(url.protocol)) {
      return "";
    }
    if (!hasProtocol && (url.protocol === "http:" || url.protocol === "https:")) {
      return url.href;
    }
    return trimmed;
  } catch {
    return "";
  }
}

export function findLinkRange(state: EditorState, linkType: MarkType) {
  const { from, to, empty, $from } = state.selection;
  if (!empty) {
    return state.doc.rangeHasMark(from, to, linkType) ? { from, to } : null;
  }

  const mark = linkType.isInSet(state.storedMarks || $from.marks());
  if (!mark) {
    return null;
  }

  let start = from;
  while (start > 0 && state.doc.rangeHasMark(start - 1, start, linkType)) {
    start -= 1;
  }

  let end = from;
  while (
    end < state.doc.content.size &&
    state.doc.rangeHasMark(end, end + 1, linkType)
  ) {
    end += 1;
  }

  return start === end ? null : { from: start, to: end };
}

export function buildKeymap(schema: Schema, openLinkDialog: () => void) {
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

  const bindings = {
    "Mod-b": toggleMark(schema.marks.strong),
    "Mod-B": toggleMark(schema.marks.strong),
    "Mod-i": toggleMark(schema.marks.em),
    "Mod-I": toggleMark(schema.marks.em),
    "Mod-k": linkCommand,
    "Mod-K": linkCommand,
    Enter: splitListItem(schema.nodes.list_item),
    "Shift-Enter": hardBreak,
    "Mod-Enter": hardBreak,
    "Mod-z": undo,
    "Mod-y": redo,
    "Mod-Shift-z": redo,
    "Shift-Tab": liftListItem(schema.nodes.list_item),
    Tab: sinkListItem(schema.nodes.list_item),
  } as Record<string, PMCommand>;

  return [keymap(bindings), keymap(baseKeymap)];
}

export function createSlashCommands(schema: Schema): SlashCommandItem[] {
  const commands: SlashCommandItem[] = [
    {
      id: "paragraph",
      label: "Paragraph",
      description: "Normal text",
      aliases: ["p", "text"],
      command: setBlockType(schema.nodes.paragraph),
    },
    {
      id: "heading1",
      label: "Heading 1",
      description: "Large section heading",
      aliases: ["h1"],
      command: setBlockType(schema.nodes.heading, { level: 1 }),
    },
    {
      id: "heading2",
      label: "Heading 2",
      description: "Medium section heading",
      aliases: ["h2"],
      command: setBlockType(schema.nodes.heading, { level: 2 }),
    },
    {
      id: "heading3",
      label: "Heading 3",
      description: "Small section heading",
      aliases: ["h3"],
      command: setBlockType(schema.nodes.heading, { level: 3 }),
    },
    {
      id: "heading4",
      label: "Heading 4",
      description: "Tiny section heading",
      aliases: ["h4"],
      command: setBlockType(schema.nodes.heading, { level: 4 }),
    },
    {
      id: "bullet_list",
      label: "Bulleted list",
      description: "Create a simple bullet list",
      aliases: ["ul", "list"],
      command: wrapInList(schema.nodes.bullet_list),
    },
    {
      id: "ordered_list",
      label: "Numbered list",
      description: "Create a numbered list",
      aliases: ["ol", "1."],
      command: wrapInList(schema.nodes.ordered_list),
    },
    {
      id: "blockquote",
      label: "Quote",
      description: "Highlight supporting text",
      aliases: ["quote", "blockquote"],
      command: wrapIn(schema.nodes.blockquote),
    },
  ];

  if (schema.nodes.horizontal_rule) {
    commands.push({
      id: "horizontal_rule",
      label: "Divider",
      description: "Insert a horizontal divider",
      aliases: ["divider", "hr"],
      command: createHorizontalRuleCommand(schema),
    });
  }

  return commands;
}

export function filterSlashCommands(
  commands: SlashCommandItem[],
  query: string
) {
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

export function createInputPlugins(schema: Schema, openLinkDialog: () => void) {
  return [
    history(),
    inputRules({ rules: createInputRules(schema) }),
    ...buildKeymap(schema, openLinkDialog),
  ];
}
