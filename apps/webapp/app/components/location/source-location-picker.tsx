/**
 * Source Location Picker
 *
 * The Popover + click-list control behind every "From location" / "At
 * location" question about a quantity-tracked pool: custody's Assign and
 * Adjust quantity, and the booking check-out's "Where do the units come
 * from?". It only picks: the caller owns the label, the option words and the
 * hidden input that posts the answer, because each flow posts it differently.
 *
 * Keyboard: the popover opens on the selected option, the arrow keys move
 * focus, and Enter or Space picks the focused option. Hovering an option
 * focuses it, so the highlight, the focus and the key that picks always agree.
 *
 * @see {@link file://../assets/custody-source-select.tsx}
 * @see {@link file://../booking/checkout-source-select.tsx}
 */

import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";

/** One choice: the value posted for it and the words shown for it. */
export type SourceLocationPickerOption = { value: string; label: string };

/** Props for {@link SourceLocationPicker}. */
export type SourceLocationPickerProps = {
  /** Id of the trigger button, so a `<label htmlFor>` can name it. */
  id: string;
  /** The choices, in display order. */
  options: SourceLocationPickerOption[];
  /** The selected option's `value`. */
  value: string;
  /** Called with the chosen option's `value`. */
  onChange: (value: string) => void;
  /** Accessible name of the option list. */
  listLabel: string;
  /**
   * Accessible name of the trigger, for a picker with no visible `<label>`.
   * Leave unset when a label points at `id`.
   */
  triggerAriaLabel?: string;
  disabled?: boolean;
  /** Smaller trigger text and padding, for a scanned row in a drawer. */
  compact?: boolean;
  /** Classes for the trigger's box, to fit it to the row it sits in. */
  triggerClassName?: string;
};

/**
 * A single-choice popover list of a pool's locations.
 *
 * @param props - See {@link SourceLocationPickerProps}
 */
export function SourceLocationPicker({
  id,
  options,
  value,
  onChange,
  listLabel,
  triggerAriaLabel,
  disabled = false,
  compact = false,
  triggerClassName,
}: SourceLocationPickerProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  /** One entry per option, so the arrow keys can move focus with the highlight. */
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const selected = options.find((option) => option.value === value) ?? null;

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /**
   * The arrow keys and the pointer move keyboard focus, and focus moves the
   * highlight (see each option's `onFocus`), so the highlighted option is
   * always the one that has focus. Enter and Space are handled by the focused
   * option alone; this list-level handler never picks, so one key press makes
   * one choice.
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? Math.min(highlightedIndex + 1, options.length - 1)
        : Math.max(highlightedIndex - 1, 0);
    itemRefs.current[next]?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled && next) return;
        setOpen(next);
        if (next) {
          const index = options.findIndex((o) => o.value === value);
          setHighlightedIndex(index >= 0 ? index : 0);
        }
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={triggerAriaLabel}
          disabled={disabled}
          className={tw("w-full", disabled && "cursor-not-allowed opacity-60")}
        >
          <div
            className={tw(
              "flex w-full items-center justify-between whitespace-nowrap rounded border border-gray-300 bg-white text-gray-900 hover:cursor-pointer",
              compact ? "px-2 py-1 text-xs" : "px-[14px] py-2 text-sm",
              triggerClassName
            )}
          >
            <span className="truncate whitespace-nowrap pr-2 text-left">
              {selected ? selected.label : "Select a location"}
            </span>
            <ChevronDownIcon className="shrink-0 text-gray-500" />
          </div>
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="z-[999999] max-h-[280px] w-[var(--radix-popover-trigger-width)] overflow-auto rounded-md border border-gray-200 bg-white shadow-md"
          onKeyDown={handleKeyDown}
          // Open on the selected option (set in `onOpenChange`), not on the
          // first one the popover would focus by default.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            itemRefs.current[highlightedIndex]?.focus();
          }}
        >
          <ul role="listbox" aria-label={listLabel} className="py-1">
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  // The unplaced option's value is "" in the check-out flow.
                  key={option.value || "unplaced"}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={tw(
                    "cursor-pointer px-4 py-2 text-sm text-gray-700 hover:bg-gray-50",
                    index === highlightedIndex && "bg-gray-50",
                    isSelected && "font-medium"
                  )}
                  onClick={() => choose(option.value)}
                  onMouseEnter={() =>
                    itemRefs.current[index]?.focus({ preventScroll: true })
                  }
                  onFocus={() => setHighlightedIndex(index)}
                  onKeyDown={handleActivationKeyPress(() =>
                    choose(option.value)
                  )}
                >
                  {option.label}
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
