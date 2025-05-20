import type { RefObject } from "react";
import { forwardRef } from "react";

import { tw } from "~/utils/tw";
import { InnerLabel } from "./inner-label";
import type { IconType } from "../shared/icons-map";
import iconsMap from "../shared/icons-map";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> {
  name?: string;

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
  icon?: IconType;

  /** Class name for the icon */
  iconClassName?: string;

  /** Add on to the input. Cannot be used together with icon  */
  addOn?: string;

  /** Class name for the wrapper element */
  className?: string;

  /** Class name for the input element */
  inputClassName?: string;

  /** Error message */
  error?: string;

  /** Choose to hide the error text. Only outline will show */
  hideErrorText?: boolean;

  /** Needed for input type textarea */
  rows?: number;

  /** Sometimes you want to append a button to the input field. Set this to true to manage the style */
  hasAttachedButton?: boolean;

  required?: boolean;
}

const Input = forwardRef(function Input(
  {
    className,
    inputClassName,
    error,
    hideErrorText,
    inputType = "input",
    label,
    hideLabel,
    hasAttachedButton = false,
    addOn,
    onChange,
    icon,
    iconClassName,
    required = false,
    ...rest
  }: InputProps,
  ref
) {
  const iconClasses = tw(
    "pointer-events-none absolute flex h-full items-center border-gray-300 px-[14px]",
    iconClassName
  );

  const addonClasses = tw(
    "pointer-events-none flex items-center rounded-l-[4px] border-y border-l border-gray-300 bg-white px-[14px] text-gray-600"
  );

  const inputClasses = tw(
    "w-full max-w-full border border-gray-300 px-[14px] py-2 text-[16px] text-gray-900 shadow outline-none placeholder:text-gray-500 focus:border-primary-300 focus:ring-[0] disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-50 disabled:text-gray-500",
    /** Add some border for error */
    error ? "border-error-300 focus:border-error-300 focus:ring-error-100" : "",

    /** Add or remove classes depending on weather we use an icon or addOn */
    icon || addOn
      ? icon
        ? "rounded-[4px] pl-[42px]"
        : "rounded-l-none rounded-r-[4px]"
      : "rounded-[4px]",
    hasAttachedButton ? tw("rounded-r-none") : undefined,
    inputClassName
  );

  /** Store props in an object for easier dynamic rendering of input type */
  const inputProps = {
    className: inputClasses,
    onChange,
    ref,
    ...rest,
  };

  let input = (
    <input
      {...inputProps}
      aria-label={label}
      ref={ref as RefObject<HTMLInputElement> | undefined}
    />
  );

  if (inputType === "textarea") {
    input = (
      <textarea
        {...inputProps}
        maxLength={rest.maxLength || 250}
        rows={rest.rows || 8}
        ref={ref as RefObject<HTMLTextAreaElement> | undefined}
        aria-label={label}
      />
    );
  }

  return (
    <label
      className={tw("relative flex flex-col", className)}
      htmlFor={inputProps.name}
    >
      {/* Label */}
      <InnerLabel hideLg={hideLabel} required={required}>
        {label}
      </InnerLabel>

      <div className={`input-wrapper relative flex flex-wrap items-stretch`}>
        {/* IconType */}
        {icon && <div className={iconClasses}>{iconsMap[icon]}</div>}
        {/* Addon */}
        {addOn && <div className={addonClasses}>{addOn}</div>}
        {/* Input */}
        {input}
      </div>

      {/* Error */}
      {!hideErrorText && error && (
        <div className="text-sm text-error-500">{error}</div>
      )}
    </label>
  );
});

export default Input;
