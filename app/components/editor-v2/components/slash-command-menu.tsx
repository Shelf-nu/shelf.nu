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
                  ? "bg-gray-200 text-gray-900"
                  : "text-gray-700 hover:bg-gray-100"
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
