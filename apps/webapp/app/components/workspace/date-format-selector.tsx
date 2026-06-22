/**
 * DateFormatSelector
 *
 * Workspace setting control for {@link DateFormat}. Lets an admin choose how
 * dates are rendered across the app. Mirrors the small-enum dropdown pattern of
 * {@link file://./qr-id-display-preference-selector.tsx} but for a fixed set of
 * four options, with a live preview of today's date in the chosen format.
 *
 * The chosen value is submitted via a hidden input (`name`) inside the workspace
 * edit form. The preview is purely cosmetic and uses the same locale mapping the
 * runtime resolver uses, so "what you see here" matches "what shows up on rows".
 *
 * @see {@link file://../../utils/date-format.ts} resolveDateFormat / dateFormatToLocale
 */
import { useRef, useState } from "react";

import type { DateFormat } from "@prisma/client";
import {
  Popover,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@radix-ui/react-popover";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { NUMERIC_DATE_OPTIONS, dateFormatToLocale } from "~/utils/date-format";
import { handleActivationKeyPress } from "~/utils/keyboard";
import { tw } from "~/utils/tw";
import When from "../when/when";

type Option = {
  value: DateFormat;
  label: string;
  description: string;
};

const OPTIONS: Option[] = [
  {
    value: "AUTO",
    label: "Automatic",
    description: "Follow each user's browser language (current default)",
  },
  {
    value: "DD_MM_YYYY",
    label: "Day / Month / Year",
    description: "e.g. 03/04/2026",
  },
  {
    value: "MM_DD_YYYY",
    label: "Month / Day / Year",
    description: "e.g. 04/03/2026",
  },
  {
    value: "YYYY_MM_DD",
    label: "Year / Month / Day",
    description: "e.g. 2026-04-03",
  },
];

/**
 * Formats today's date the way the given preference will render numeric dates.
 * For AUTO this uses the viewer's browser locale (undefined → runtime default).
 *
 * @param value - The date-format preference to preview
 * @returns A formatted example of today's date
 */
function previewToday(value: DateFormat): string {
  const locale = dateFormatToLocale(value) ?? undefined;
  try {
    return new Intl.DateTimeFormat(locale, NUMERIC_DATE_OPTIONS).format(
      new Date()
    );
  } catch {
    return "";
  }
}

type DateFormatSelectorProps = {
  className?: string;
  defaultValue: DateFormat;
  name?: string;
};

export default function DateFormatSelector({
  className,
  defaultValue,
  name,
}: DateFormatSelectorProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  // Lazy initializer: after mount this is user-controlled, so it must NOT
  // re-sync with the prop (matches the sibling selectors' lint-safe pattern).
  const [selected, setSelected] = useState<DateFormat>(() => defaultValue);

  const selectedOption =
    OPTIONS.find((option) => option.value === selected) ?? OPTIONS[0];

  function handleSelect(value: DateFormat) {
    setSelected(value);
    setIsOpen(false);
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            // type="button" required by local-rules/require-button-type — this
            // trigger sits inside the workspace edit fetcher.Form, so the native
            // "submit" default would submit the form on open.
            type="button"
            // text-left overrides <button>'s default center alignment for the
            // wrapped two-line label/description.
            className={tw(
              "flex min-h-[44px] w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left",
              className
            )}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-medium text-gray-900">
                {selectedOption.label}
              </span>
              <span className="truncate text-xs text-gray-500">
                {selectedOption.description}
              </span>
            </span>
            <ChevronDownIcon className="size-4 shrink-0 text-gray-500" />
            <input type="hidden" name={name} value={selectedOption.value} />
          </button>
        </PopoverTrigger>
        <PopoverPortal>
          <PopoverContent
            className="z-[999999] max-h-[400px] overflow-scroll rounded-md border bg-white"
            side="bottom"
            style={{ width: triggerRef?.current?.clientWidth }}
          >
            {OPTIONS.map((option) => {
              const isSelected = selectedOption.value === option.value;
              return (
                <div
                  key={option.value}
                  className="flex items-start justify-between gap-3 px-4 py-3 hover:cursor-pointer hover:bg-gray-50"
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  onClick={() => {
                    handleSelect(option.value);
                  }}
                  onKeyDown={handleActivationKeyPress(() =>
                    handleSelect(option.value)
                  )}
                >
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {option.label}
                    </span>
                    <span className="text-xs text-gray-500">
                      {option.description}
                    </span>
                  </div>
                  <When truthy={isSelected}>
                    <CheckIcon className="size-4 shrink-0 text-primary" />
                  </When>
                </div>
              );
            })}
          </PopoverContent>
        </PopoverPortal>
      </Popover>

      <div
        className="flex items-center gap-2 text-xs text-gray-500"
        aria-live="polite"
      >
        <span>Dates will look like:</span>
        <span className="font-medium text-gray-700">
          {previewToday(selectedOption.value)}
        </span>
      </div>
    </div>
  );
}
