import { createPortal } from "react-dom";
import { tw } from "~/utils/tw";
import type { SlashCommandItem, SlashState } from "../types";

interface SlashCommandMenuProps {
  state: SlashState | null;
  commands: SlashCommandItem[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onRun: (command: SlashCommandItem) => void;
}

export function SlashCommandMenu({
  state,
  commands,
  selectedIndex,
  onSelect,
  onRun,
}: SlashCommandMenuProps) {
  if (!state || !state.active || commands.length === 0) {
    return null;
  }

  const menu = (
    <div
      className="fixed z-50 w-64 overflow-hidden rounded-md border border-color-200 bg-surface shadow-xl"
      style={{
        left: `${state.left}px`,
        top: `${state.top}px`,
      }}
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
                  ? "bg-color-200 text-color-900"
                  : "text-color-700 hover:bg-color-100"
              )}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onRun(command)}
              onMouseEnter={() => onSelect(index)}
            >
              <div className="font-medium">{command.label}</div>
              <div className="text-xs text-color-500">
                {command.description}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  // Render the menu using a portal so it's not clipped by overflow-hidden containers
  return createPortal(menu, document.body);
}
