import type { Icon } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Label for the input field */
  label: string;

  /** Weather the label is hidden */
  hideLabel?: boolean;

  /** name of any icon available in icons map */
  icon?: Icon;

  /** Add on to the input. Cannot be used together with icon  */
  addOn?: string;

  className?: string;

  /** Error message */
  error?: string;
}

export default function Input({
  className,
  error,
  label,
  hideLabel,
  addOn,
  icon,
  ...rest
}: Props) {
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

      <div
        className={`relative flex flex-wrap items-stretch  ${icon ? "" : ""}`}
      >
        {/* Icon */}
        {icon && (
          <div className="pointer-events-none absolute flex h-full items-center  border-gray-300  px-[14px]">
            {iconsMap[icon]}
          </div>
        )}

        {/* Addon */}
        {addOn && (
          <div className="pointer-events-none flex items-center rounded-l-[8px] border-y border-l border-gray-300 bg-white px-[14px] text-gray-600">
            {addOn}
          </div>
        )}

        {/* Input */}
        <input
          className={` border px-[14px] py-2 text-text-md text-gray-900 shadow placeholder:text-gray-500 focus:ring-2 ${
            error
              ? "border-error-300 focus:border-error-300 focus:ring-error-100"
              : "border-gray-300 focus:border-primary-300 focus:ring-primary-100"
          } ${
            icon || addOn
              ? icon
                ? "rounded-[8px] pl-[42px]"
                : "rounded-r-[8px] rounded-l-none"
              : "rounded-[8px]"
          } ${className}`}
          {...rest}
        />
      </div>

      {/* Error */}
      {error && <div className="text-sm text-error-500">{error}</div>}
    </label>
  );
}
