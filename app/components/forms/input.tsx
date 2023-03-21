import { tw } from "~/utils";
import type { Icon } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

interface Props
  extends React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> {
  /** Label for the input field */
  label: string;

  /** Type of the input. Default is input. Possible options are:
   * - input
   * - textarea
   */
  inputType?: "input" | "textarea";

  /** Weather the label is hidden */
  hideLabel?: boolean;

  /** name of any icon available in icons map */
  icon?: Icon;

  /** Add on to the input. Cannot be used together with icon  */
  addOn?: string;

  className?: string;

  /** Error message */
  error?: string;

  /** Needed for input type textarea */
  rows?: number;
}

export default function Input({
  className,
  error,
  inputType = "input",
  label,
  hideLabel,
  addOn,
  icon,
  ...rest
}: Props) {
  const iconClasses = tw(
    "pointer-events-none absolute flex h-full items-center  border-gray-300  px-[14px]"
  );

  const addonClasses = tw(
    "pointer-events-none flex items-center rounded-l-[8px] border-y border-l border-gray-300 bg-white px-[14px] text-gray-600"
  );

  const inputClasses = tw(
    "border border-gray-300 px-[14px] py-2 text-text-md text-gray-900 shadow placeholder:text-gray-500 focus:border-primary-300 focus:ring-[0]",
    /** Add some border for error */
    error ? "border-error-300 focus:border-error-300 focus:ring-error-100" : "",

    /** Add or remove classes depending on weather we use an icon or addOn */
    icon || addOn
      ? icon
        ? "rounded-[8px] pl-[42px]"
        : "rounded-r-[8px] rounded-l-none"
      : "rounded-[8px]",
    className
  );

  /** Store props in an object for easier dynamic rendering of input type */
  const inputProps = {
    className: inputClasses,
    ...rest,
  };
  let input = <input {...inputProps} />;

  if (inputType === "textarea") {
    input = <textarea {...inputProps} rows={rest.rows || 8} />;
  }

  return (
    <label className="relative flex flex-col">
      {/* Label */}
      <span
        className={`mb-[6px] text-text-sm font-medium text-gray-700 ${
          hideLabel && "hidden"
        }`}
      >
        {label}
      </span>

      <div className={`relative flex flex-wrap items-stretch`}>
        {/* Icon */}
        {icon && <div className={iconClasses}>{iconsMap[icon]}</div>}
        {/* Addon */}
        {addOn && <div className={addonClasses}>{addOn}</div>}
        {/* Input */}
        {input}
      </div>

      {/* Error */}
      {error && <div className="text-sm text-error-500">{error}</div>}
    </label>
  );
}
