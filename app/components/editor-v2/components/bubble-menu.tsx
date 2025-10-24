import { Bold, Italic, Link as LinkIcon } from "lucide-react";

import type { BubbleState } from "../types";
import { ToolbarButton } from "./toolbar";

interface BubbleMenuProps {
  state: BubbleState;
  onBold: () => void;
  onItalic: () => void;
  onLink: () => void;
  boldActive: boolean;
  italicActive: boolean;
  linkActive: boolean;
}

export function BubbleMenu({
  state,
  onBold,
  onItalic,
  onLink,
  boldActive,
  italicActive,
  linkActive,
}: BubbleMenuProps) {
  if (!state.visible) {
    return null;
  }

  return (
    <div
      className="absolute z-50 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 shadow-lg"
      style={{
        left: `${state.left}px`,
        top: `${state.top}px`,
      }}
      role="toolbar"
      aria-label="Inline formatting"
    >
      <ToolbarButton
        label="Bold"
        icon={<Bold size={16} aria-hidden="true" />}
        onClick={onBold}
        active={boldActive}
        isToggle
      />
      <ToolbarButton
        label="Italic"
        icon={<Italic size={16} aria-hidden="true" />}
        onClick={onItalic}
        active={italicActive}
        isToggle
      />
      <ToolbarButton
        label="Link"
        icon={<LinkIcon size={16} aria-hidden="true" />}
        onClick={onLink}
        active={linkActive}
        isToggle
      />
    </div>
  );
}
