import type { ReactNode } from "react";

import {
  Bold,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  RotateCcw,
  RotateCw,
  Type,
} from "lucide-react";

import { tw } from "~/utils/tw";

import type { ToolbarBlock, ToolbarState } from "../types";

interface ToolbarButtonProps {
  label: string;
  tooltip?: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  isToggle?: boolean;
}

export function ToolbarButton({
  label,
  tooltip,
  icon,
  onClick,
  active = false,
  disabled,
  isToggle,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={tw(
        "inline-flex size-9 items-center justify-center rounded-md transition",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
        disabled ? "cursor-not-allowed opacity-50" : ""
      )}
      aria-label={tooltip ?? label}
      title={tooltip ?? label}
      aria-pressed={isToggle ? active : undefined}
      data-active={active ? "true" : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (disabled) return;
        onClick();
      }}
      disabled={disabled}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  );
}

interface ParagraphSelectProps {
  value: ToolbarBlock;
  onChange: (value: ToolbarBlock) => void;
}

export function ParagraphSelect({ value, onChange }: ParagraphSelectProps) {
  const normalized = value === "raw_block" ? "paragraph" : value;
  return (
    <label className="text-muted-foreground inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-2 text-sm">
      <Type size={18} strokeWidth={1.5} aria-hidden="true" />
      <span className="sr-only">Text style</span>
      <select
        className="text-foreground h-full bg-transparent text-sm focus:outline-none"
        aria-label="Text style"
        title="Text style"
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

interface EditorToolbarProps {
  state: ToolbarState;
  onUndo: () => void;
  onRedo: () => void;
  onParagraphChange: (value: ToolbarBlock) => void;
  onBold: () => void;
  onItalic: () => void;
  onToggleLink: () => void;
  onBulletList: () => void;
  onOrderedList: () => void;
  onQuote: () => void;
  onDivider?: () => void;
  hasDivider: boolean;
}

export function EditorToolbar({
  state,
  onUndo,
  onRedo,
  onParagraphChange,
  onBold,
  onItalic,
  onToggleLink,
  onBulletList,
  onOrderedList,
  onQuote,
  onDivider,
  hasDivider,
}: EditorToolbarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
      role="toolbar"
      aria-label="Editor formatting toolbar"
    >
      <div className="flex items-center gap-2">
        <ToolbarButton
          label="Undo"
          tooltip="Undo (⌘Z)"
          icon={<RotateCcw size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onUndo}
          disabled={!state.canUndo}
        />
        <ToolbarButton
          label="Redo"
          tooltip="Redo (⌘⇧Z)"
          icon={<RotateCw size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onRedo}
          disabled={!state.canRedo}
        />
      </div>
      <ParagraphSelect value={state.block} onChange={onParagraphChange} />
      <div className="flex items-center gap-2">
        <ToolbarButton
          label="Bold"
          tooltip="Bold (⌘B)"
          icon={<Bold size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onBold}
          active={state.bold}
          isToggle
        />
        <ToolbarButton
          label="Italic"
          tooltip="Italic (⌘I)"
          icon={<Italic size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onItalic}
          active={state.italic}
          isToggle
        />
        <ToolbarButton
          label="Link"
          tooltip="Link (⌘⇧K)"
          icon={<Link2 size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onToggleLink}
          active={state.link}
          isToggle
        />
      </div>
      <div className="flex items-center gap-2">
        <ToolbarButton
          label="Bulleted list"
          tooltip="Bulleted list (⌘⇧8)"
          icon={<List size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onBulletList}
          active={state.block === "bullet_list"}
          isToggle
        />
        <ToolbarButton
          label="Numbered list"
          tooltip="Numbered list (⌘⇧7)"
          icon={<ListOrdered size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onOrderedList}
          active={state.block === "ordered_list"}
          isToggle
        />
      </div>
      <div className="flex items-center gap-2">
        <ToolbarButton
          label="Quote"
          tooltip="Quote (⌘⇧9)"
          icon={<Quote size={18} strokeWidth={1.5} aria-hidden="true" />}
          onClick={onQuote}
          active={state.block === "blockquote"}
          isToggle
        />
        {hasDivider && onDivider ? (
          <ToolbarButton
            label="Divider"
            tooltip="Divider (---)"
            icon={<Minus size={18} strokeWidth={1.5} aria-hidden="true" />}
            onClick={onDivider}
          />
        ) : null}
      </div>
    </div>
  );
}
