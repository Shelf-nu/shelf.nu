/**
 * @file The per-row destination picker of the import mapping review.
 *
 * A Popover list (the repo's replacement for the deprecated DropdownMenu) of
 * every Shelf field the importer reads, plus "Custom field..." and "Skip".
 * Barcode fields are listed only when the workspace has the barcode add-on.
 *
 * @see {@link file://./mapping-review.tsx} the table that renders one per row
 */
import type { KeyboardEvent } from "react";
import { useMemo, useReducer } from "react";
import { CustomFieldType } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { ChevronRight } from "~/components/icons/library";
import { Button } from "~/components/shared/button";
import { IMPORT_FIELDS, getImportField } from "~/modules/import-mapping/fields";
import type { ColumnTarget } from "~/modules/import-mapping/types";
import {
  MAX_CUSTOM_FIELD_NAME_LENGTH,
  customFieldNameSchema,
} from "~/modules/import-mapping/types";
import { FIELD_TYPE_NAME } from "~/utils/custom-fields";
import { tw } from "~/utils/tw";

/** Open state, search text and keyboard highlight of the picker. */
type PickerState = { open: boolean; query: string; activeIndex: number };

/** Transitions of {@link PickerState}. */
type PickerAction =
  | { type: "open_changed"; open: boolean }
  | { type: "chosen" }
  | { type: "searched"; query: string }
  | { type: "moved"; delta: 1 | -1; count: number }
  | { type: "hovered"; index: number };

const CLOSED_PICKER: PickerState = { open: false, query: "", activeIndex: 0 };

/**
 * Reducer for {@link TargetSelect}. Opening or closing starts the highlight
 * at the top and closing clears the search, so every opening begins fresh; a
 * new search also starts at the top of the filtered list.
 *
 * @param state - Current picker state
 * @param action - The transition to apply
 * @returns The next state
 */
function pickerReducer(state: PickerState, action: PickerAction): PickerState {
  switch (action.type) {
    case "open_changed":
      return action.open
        ? { ...state, open: true, activeIndex: 0 }
        : CLOSED_PICKER;
    case "chosen":
      return { ...state, open: false, query: "" };
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

/** One entry of the picker list. */
type Option = {
  key: string;
  label: string;
  hint: string;
  target: ColumnTarget;
};

/**
 * A custom field name derived from the column's own heading, cleaned so the
 * importer's `cf:` header can carry it.
 */
function suggestCustomFieldName(source: string): string {
  const cleaned = source
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CUSTOM_FIELD_NAME_LENGTH);
  return customFieldNameSchema.safeParse(cleaned).success
    ? cleaned
    : "New field";
}

/**
 * The label a target shows on the picker button.
 *
 * @param target - The column's current destination
 * @returns Plain-language text, for example "Custom field: Serial number (Single-line text)"
 */
export function describeTarget(target: ColumnTarget): string {
  switch (target.kind) {
    case "field":
      return getImportField(target.name).label;
    case "customField":
      return `Custom field: ${target.name || "unnamed"} (${
        FIELD_TYPE_NAME[target.type]
      })`;
    case "skip":
      return "Skip";
  }
}

/**
 * Picks where one spreadsheet column goes.
 *
 * @param props.id - Unique id prefix for this row, so duplicate or empty
 *   headings never share element ids
 * @param props.source - The column's heading, used for the accessible name
 *   and as the suggested name of a new custom field
 * @param props.value - The current destination
 * @param props.onChange - Called with the new destination
 * @param props.canUseBarcodes - Lists barcode fields when true
 * @param props.invalid - Marks the button when the row has a problem
 * @param props.describedBy - Id of the row's error text, if any
 */
export function TargetSelect({
  id,
  source,
  value,
  onChange,
  canUseBarcodes,
  invalid,
  describedBy,
}: {
  id: string;
  source: string;
  value: ColumnTarget;
  onChange: (target: ColumnTarget) => void;
  canUseBarcodes: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [{ open, query, activeIndex }, dispatch] = useReducer(
    pickerReducer,
    CLOSED_PICKER
  );

  const options = useMemo<Option[]>(() => {
    const fields: Option[] = IMPORT_FIELDS.filter(
      (field) =>
        !("requiresBarcodes" in field && field.requiresBarcodes) ||
        canUseBarcodes
    ).map((field) => ({
      key: `field:${field.name}`,
      label: field.label,
      hint: field.hint,
      target: { kind: "field", name: field.name },
    }));
    return [
      ...fields,
      {
        key: "customField",
        label: "Custom field...",
        hint: "Keep this column as a custom field",
        target: {
          kind: "customField",
          name:
            value.kind === "customField"
              ? value.name
              : suggestCustomFieldName(source),
          type:
            value.kind === "customField" ? value.type : CustomFieldType.TEXT,
        },
      },
      {
        key: "skip",
        label: "Skip",
        hint: "Do not import this column",
        target: { kind: "skip" },
      },
    ];
  }, [canUseBarcodes, source, value]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      option.label.toLowerCase().includes(needle)
    );
  }, [options, query]);

  const choose = (option: Option) => {
    onChange(option.target);
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
      const option = visible[activeIndex];
      if (option) choose(option);
    }
  };

  const listId = `${id}-options`;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => dispatch({ type: "open_changed", open: next })}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          aria-label={`Shelf field for column ${source}: ${describeTarget(
            value
          )}`}
          aria-describedby={describedBy}
          className={tw(
            "w-full justify-start whitespace-nowrap font-normal [&_span]:max-w-full [&_span]:truncate",
            invalid && "border-error-300"
          )}
        >
          <ChevronRight className="inline-block shrink-0 rotate-90" />
          <span className="ml-2">{describeTarget(value)}</span>
        </Button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          align="start"
          className="z-[999999] mt-2 max-h-[360px] w-[320px] overflow-auto rounded-md border border-gray-200 bg-white shadow-md"
        >
          <input
            aria-label="Search Shelf fields"
            aria-controls={listId}
            placeholder="Search fields..."
            className="w-full border-0 border-b border-gray-200 px-4 py-2 text-[14px] focus:ring-0"
            value={query}
            onChange={(event) =>
              dispatch({ type: "searched", query: event.target.value })
            }
            onKeyDown={handleKeyDown}
          />
          <div id={listId} role="listbox" aria-label="Shelf fields">
            {visible.map((option, index) => {
              const selected =
                option.target.kind === value.kind &&
                (option.target.kind !== "field" ||
                  (value.kind === "field" &&
                    value.name === option.target.name));
              return (
                <div
                  key={option.key}
                  role="option"
                  aria-selected={selected}
                  tabIndex={0}
                  className={tw(
                    "cursor-pointer px-4 py-2 text-[14px] hover:bg-gray-50",
                    index === activeIndex && "bg-gray-50",
                    selected && "font-semibold"
                  )}
                  onClick={() => choose(option)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      choose(option);
                    }
                  }}
                  onMouseEnter={() => dispatch({ type: "hovered", index })}
                >
                  <div className="text-gray-900">{option.label}</div>
                  <div className="text-xs text-gray-500">{option.hint}</div>
                </div>
              );
            })}
            {visible.length === 0 ? (
              <div className="px-4 py-2 text-[14px] text-gray-500">
                No fields found
              </div>
            ) : null}
          </div>
        </PopoverContent>
      </PopoverPortal>
    </Popover>
  );
}
