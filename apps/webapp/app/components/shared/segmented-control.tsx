/**
 * SegmentedControl — a compact single-choice control for 2–6 short options
 * (paper size, label size, what prints on a label).
 *
 * Styled like `<Tabs>` (`shared/tabs.tsx`): a slate track with the active
 * option lifted on white. Every option is a real `<button>` with
 * `aria-pressed`, so keyboard and screen-reader users get the state for free.
 * Use `<Select>` instead when the options need grouping or exceed one row.
 *
 * @see {@link file://./tabs.tsx}
 */
import { tw } from "~/utils/tw";

/** One option of a {@link SegmentedControl}. */
export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  /** Native tooltip, e.g. the printers a label size matches. */
  title?: string;
};

/**
 * @param props.value - the selected option's value
 * @param props.options - the options, in display order
 * @param props.onChange - called with the clicked option's value
 * @param props.ariaLabel - accessible name of the whole group
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T;
  options: Array<SegmentedOption<T>>;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={tw(
        "inline-flex flex-wrap gap-1 rounded-md bg-slate-100 p-1",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={tw(
              "rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
              active
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
