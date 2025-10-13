import type { ReactNode } from "react";

import { tw } from "~/utils/tw";

import type { ToolbarBlock, ToolbarState } from "../types";

interface ToolbarButtonProps {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  isToggle?: boolean;
}

export function ToolbarButton({
  label,
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
        "inline-flex h-9 items-center justify-center gap-1 rounded px-2 text-sm font-medium transition",
        active ? "bg-gray-200 text-gray-900" : "text-gray-600 hover:bg-gray-100",
        disabled ? "cursor-not-allowed opacity-50" : ""
      )}
      aria-label={label}
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
      <span className={icon ? "sr-only" : undefined}>{label}</span>
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
    <label className="inline-flex items-center gap-2 text-sm text-gray-600">
      <span className="sr-only">Paragraph style</span>
      <select
        className="h-9 rounded border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-200"
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
      className="flex flex-wrap items-center gap-2"
      role="toolbar"
      aria-label="Editor formatting toolbar"
    >
      <ToolbarButton label="Undo" onClick={onUndo} disabled={!state.canUndo} />
      <ToolbarButton label="Redo" onClick={onRedo} disabled={!state.canRedo} />
      <ParagraphSelect value={state.block} onChange={onParagraphChange} />
      <ToolbarButton
        label="Bold"
        onClick={onBold}
        active={state.bold}
        isToggle
      />
      <ToolbarButton
        label="Italic"
        onClick={onItalic}
        active={state.italic}
        isToggle
      />
      <ToolbarButton
        label="Link"
        onClick={onToggleLink}
        active={state.link}
        isToggle
      />
      <ToolbarButton
        label="Bulleted list"
        onClick={onBulletList}
        active={state.block === "bullet_list"}
        isToggle
      />
      <ToolbarButton
        label="Numbered list"
        onClick={onOrderedList}
        active={state.block === "ordered_list"}
        isToggle
      />
      <ToolbarButton
        label="Quote"
        onClick={onQuote}
        active={state.block === "blockquote"}
        isToggle
      />
      {hasDivider && onDivider ? (
        <ToolbarButton label="Divider" onClick={onDivider} />
      ) : null}
    </div>
  );
}
