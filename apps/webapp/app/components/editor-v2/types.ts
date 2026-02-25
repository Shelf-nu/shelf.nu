import type { Command as PMCommand } from "prosemirror-state";

export type ToolbarBlock =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "bullet_list"
  | "ordered_list"
  | "blockquote"
  | "raw_block";

export interface ToolbarState {
  block: ToolbarBlock;
  bold: boolean;
  italic: boolean;
  code: boolean;
  link: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface BubbleState {
  visible: boolean;
  left: number;
  top: number;
}

export interface SlashState {
  active: boolean;
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
}

export interface LinkDialogState {
  open: boolean;
  href: string;
  range: { from: number; to: number } | null;
}

export interface RawBlockDialogState {
  open: boolean;
  raw: string;
  pos: number | null;
}

export interface SlashCommandItem {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  command: PMCommand;
}
