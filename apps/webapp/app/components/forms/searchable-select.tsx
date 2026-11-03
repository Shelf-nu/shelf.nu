/**
 * @file A labelled select built on a Radix Popover, with an optional search box.
 *
 * Replaces the native `<select>` where the option list is long or carries a
 * second line of context (for example custom fields with their type). The
 * chosen value is posted through a hidden input, so the component works inside
 * a plain `<Form>` / `<fetcher.Form>` with `name` + `defaultValue` and needs no
 * controlled parent. Keyboard flow mirrors the import mapping picker: arrows
 * move the highlight, Enter picks, Escape closes, and closing clears the search.
 *
 * @see {@link file://./../assets/import-mapping/target-select.tsx} the pattern this follows
 */
import type { KeyboardEvent } from "react";
import { useId, useMemo, useReducer, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { Search } from "lucide-react";
import { CheckIcon, ChevronRight } from "~/components/icons/library";
import { tw } from "~/utils/tw";

/** One choice of a {@link SearchableSelect}. */
export type SearchableSelectOption = {
  /** The value posted through the hidden input. */
  value: string;
  /** The text shown in the list and on the trigger. */
  label: string;
  /** Muted second line or suffix, e.g. "Option" or "inactive". */
  hint?: string;
  /** Shown only while it is the current value; never listed as a choice. */
  hiddenFromList?: boolean;
};

/** Props of {@link SearchableSelect}. */
export type SearchableSelectProps = {
  /** Name of the hidden input that carries the chosen value. */
  name: string;
  /** Visible label, linked to the trigger by `aria-labelledby`. */
  label: string;
  /** The initially selected option value. */
  defaultValue: string;
  /** Every option, including any `hiddenFromList` current value. */
  options: ReadonlyArray<SearchableSelectOption>;
  /** Shows the search box. Defaults to true. */
  searchable?: boolean;
  /** Placeholder of the search box. Defaults to "Search...". */
  searchPlaceholder?: string;
  /** Text shown when the search matches nothing. Defaults to "No results". */
  emptyMessage?: string;
  /** Error text rendered under the trigger, linked by `aria-describedby`. */
  error?: string;
  /** Called with the new value after the user picks an option. */
  onChange?: (value: string) => void;
};

/** Open state, search text and keyboard highlight of the list. */
type SelectState = { open: boolean; query: string; activeIndex: number };

/** Transitions of {@link SelectState}. */
type SelectAction =
  | { type: "open_changed"; open: boolean }
  | { type: "chosen" }
  | { type: "searched"; query: string }
  | { type: "moved"; delta: 1 | -1; count: number }
  | { type: "hovered"; index: number };

const CLOSED_SELECT: SelectState = { open: false, query: "", activeIndex: 0 };

/**
 * Reducer for {@link SearchableSelect}. Every opening starts with an empty
 * search and the highlight at the top; a new search also restarts at the top.
 *
 * @param state - Current state
 * @param action - The transition to apply
 * @returns The next state
 */
function selectReducer(state: SelectState, action: SelectAction): SelectState {
  switch (action.type) {
    case "open_changed":
      return action.open ? { ...CLOSED_SELECT, open: true } : CLOSED_SELECT;
    case "chosen":
      return CLOSED_SELECT;
    case "searched":
      return { ...state, query: action.query, activeIndex: 0 };
    case "moved":
      return {
        ...state,
        activeIndex: Math.min(
          Math.max(state.activeIndex + action.delta, 0),
          Math.max(action.count - 1, 0)
        ),
      };
    case "hovered":
      return { ...state, activeIndex: action.index };
    default:
      return state;
  }
}

/**
 * A form-friendly select with an optional search box.
 *
 * The trigger shows the selected option's label (plus hint), falling back to
 * the first option when the value matches none. The hidden input always posts
 * the option the trigger shows.
 *
 * @param props - See {@link SearchableSelectProps}
 */
export function SearchableSelect({
  name,
  label,
  defaultValue,
  options,
  searchable = true,
  searchPlaceholder = "Search...",
  emptyMessage = "No results",
  error,
  onChange,
}: SearchableSelectProps) {
  const [{ open, query, activeIndex }, dispatch] = useReducer(
    selectReducer,
    CLOSED_SELECT
  );
  const [value, setValue] = useState(defaultValue);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const baseId = useId();
  const labelId = `${baseId}-label`;
  const listId = `${baseId}-options`;
  const errorId = `${baseId}-error`;

  const selected = options.find((o) => o.value === value) ?? options[0];

  const visible = useMemo(() => {
    const needle = searchable ? query.trim().toLowerCase() : "";
    return options.filter(
      (o) => !o.hiddenFromList && o.label.toLowerCase().includes(needle)
    );
  }, [options, query, searchable]);

  const choose = (option: SearchableSelectOption) => {
    setValue(option.value);
    onChange?.(option.value);
    dispatch({ type: "chosen" });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      dispatch({ type: "moved", delta: 1, count: visible.length });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      dispatch({ type: "moved", delta: -1, count: visible.length });
    } else if (event.key === "Enter") {
      event.preventDefault();
      // Nothing matches: Enter is ignored so the value stays as it was.
      const option = visible[activeIndex];
      if (option) choose(option);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm font-medium text-gray-700">
        {label}
      </span>
      <input type="hidden" name={name} value={selected?.value ?? ""} />
      <Popover
        open={open}
        onOpenChange={(next) => dispatch({ type: "open_changed", open: next })}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby={labelId}
            aria-describedby={error ? errorId : undefined}
            className={tw(
              "flex w-full items-center justify-between gap-2 rounded border bg-white px-3.5 py-2 text-left text-[16px] text-gray-900",
              "focus:outline-none focus-visible:ring-4 focus-visible:ring-primary-100",
              error ? "border-error-300" : "border-gray-300"
            )}
          >
            <span className="min-w-0 truncate">
              {selected?.label}
              {selected?.hint ? (
                <span className="ml-2 text-sm text-gray-500">
                  {selected.hint}
                </span>
              ) : null}
            </span>
            <ChevronRight className="inline-block shrink-0 rotate-90" />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            align="start"
            // Moves focus to the search box (or the list) once mounted.
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              (searchable ? searchRef.current : listRef.current)?.focus();
            }}
            onKeyDown={handleKeyDown}
            className="z-[999999] mt-2 w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-md border border-gray-200 bg-white shadow-md"
          >
            {searchable ? (
              <div className="flex items-center border-b">
                <Search className="ml-4 size-4 text-gray-500" />
                <input
                  ref={searchRef}
                  aria-label={`Search ${label}`}
                  aria-controls={listId}
                  placeholder={searchPlaceholder}
                  className="w-full border-0 px-4 py-2 pl-2 text-[14px] focus:border-0 focus:ring-0"
                  value={query}
                  onChange={(event) =>
                    dispatch({ type: "searched", query: event.target.value })
                  }
                />
              </div>
            ) : null}
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-labelledby={labelId}
              tabIndex={-1}
              className="max-h-72 overflow-y-auto focus:outline-none"
            >
              {visible.map((option, index) => {
                const isSelected = option.value === selected?.value;
                return (
                  <div
                    key={option.value}
                    role="option"
                    aria-selected={isSelected}
                    tabIndex={-1}
                    className={tw(
                      "flex cursor-pointer items-center justify-between gap-2 px-4 py-2 text-[14px] hover:bg-gray-50",
                      index === activeIndex && "bg-gray-50"
                    )}
                    onClick={() => choose(option)}
                    onMouseEnter={() => dispatch({ type: "hovered", index })}
                  >
                    <span className="min-w-0">
                      <span className="text-gray-900">{option.label}</span>
                      {option.hint ? (
                        <span className="ml-2 text-xs text-gray-500">
                          {option.hint}
                        </span>
                      ) : null}
                    </span>
                    {isSelected ? (
                      <CheckIcon className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </div>
                );
              })}
              {visible.length === 0 ? (
                <div className="px-4 py-2 text-[14px] text-gray-500">
                  {emptyMessage}
                </div>
              ) : null}
            </div>
          </PopoverContent>
        </PopoverPortal>
      </Popover>
      {error ? (
        <p id={errorId} className="text-sm text-error-500">
          {error}
        </p>
      ) : null}
    </div>
  );
}
