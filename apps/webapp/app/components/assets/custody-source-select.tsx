/**
 * Custody Source Select
 *
 * The "From location" (Assign custody) and "At location" (Adjust quantity)
 * picker for a quantity-tracked asset placed at two or more locations. Lists
 * each manual placement as
 * "Camera Room · 2 pcs", adding "· 1 in custody" when some of its units are
 * out, and "Unplaced · 3 pcs" when the pool has unplaced units.
 *
 * Built on the Popover + click-list pattern the move-units destination
 * picker uses, and mirrors its value into a hidden input so the enclosing
 * fetcher form posts it as `locationId` (a location id, or `"unplaced"` for
 * the unplaced units).
 *
 * Render it only when the pool is placed at two or more locations: callers
 * gate on `CustodySourceSummary.multiSource`, so a pool at one location keeps
 * its dialog exactly as it was.
 *
 * @see {@link file://../../modules/asset/custody-source.ts}
 * @see {@link file://./quantity-custody-dialog.tsx}
 * @see {@link file://./quick-adjust-dialog.tsx}
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
import type { CustodySourceOption } from "~/modules/asset/custody-source";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";

/**
 * The text of one option: "Camera Room · 2 pcs", "Camera Room · 2 pcs · 1 in
 * custody · 1 on a booking", or "Unplaced · 3 pcs". The same words as the
 * location page's row. Plain counts: the pool-wide availability stays the
 * dialog's Max, so these numbers never contradict it.
 */
export function formatCustodySourceOption(
  option: CustodySourceOption,
  unitLabel: string
): string {
  let text = `${option.label} · ${option.placed} ${unitLabel}`;
  if (option.inCustody > 0) text += ` · ${option.inCustody} in custody`;
  if (option.onBooking > 0) text += ` · ${option.onBooking} on a booking`;
  return text;
}

/** Props for {@link CustodySourceSelect}. */
export type CustodySourceSelectProps = {
  /** Unique id for the trigger, tying the label to it. */
  id: string;
  /** "From location" or "At location". */
  label: string;
  /** The choices, from `CustodySourceSummary.options`. */
  options: CustodySourceOption[];
  /** The selected option's `value`. */
  value: string;
  /** Called with the chosen option's `value`. */
  onChange: (value: string) => void;
  /** Unit label for the counts ("pcs", "boxes", "units"). */
  unitLabel: string;
  /**
   * Form field the value is posted under. `null` renders no hidden input,
   * for callers that build their payload themselves (the scanner drawer).
   */
  name?: string | null;
  disabled?: boolean;
  /** Smaller label and trigger, for a scanned row in a drawer. */
  compact?: boolean;
};

/**
 * A single-choice picker of a pool's sources that posts the chosen one as a
 * hidden form field.
 *
 * @param props - See {@link CustodySourceSelectProps}
 */
export function CustodySourceSelect({
  id,
  label,
  options,
  value,
  onChange,
  unitLabel,
  name = "locationId",
  disabled = false,
  compact = false,
}: CustodySourceSelectProps) {
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
    <div className="flex flex-col gap-1">
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <label
        htmlFor={id}
        className={tw(
          "font-medium text-gray-700",
          compact ? "text-xs" : "text-sm"
        )}
      >
        {label}
      </label>
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
            disabled={disabled}
            className={tw(
              "w-full",
              disabled && "cursor-not-allowed opacity-60"
            )}
          >
            <div
              className={tw(
                "flex w-full items-center justify-between whitespace-nowrap rounded border border-gray-300 hover:cursor-pointer",
                compact ? "px-2 py-1 text-xs" : "px-[14px] py-2 text-sm"
              )}
            >
              <span className="truncate whitespace-nowrap pr-2 text-left">
                {selected
                  ? formatCustodySourceOption(selected, unitLabel)
                  : "Select a location"}
              </span>
              <ChevronDownIcon className="text-gray-500" />
            </div>
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            sideOffset={4}
            className="z-[999999] max-h-[280px] w-[var(--radix-popover-trigger-width)] overflow-auto rounded-md border border-gray-200 bg-white shadow-md"
            onKeyDown={handleKeyDown}
            // Open on the selected option (set in `onOpenChange`), not on
            // the first one the popover would focus by default.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              itemRefs.current[highlightedIndex]?.focus();
            }}
          >
            <ul role="listbox" aria-label={label} className="py-1">
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <li
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
                    {formatCustodySourceOption(option, unitLabel)}
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
    </div>
  );
}
