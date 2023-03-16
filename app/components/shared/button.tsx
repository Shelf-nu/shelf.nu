import { Link } from "@remix-run/react";
import type { Icon } from "./icons-map";
import iconsMap from "./icons-map";

import type { ButtonVariant, ButtonWidth } from "../layout/header/types";

export function Button({
  as = "button",
  className = "",
  variant = "primary",
  width = "auto",
  icon,
  disabled = undefined,
  children,
  ...props
}: {
  as?: React.ElementType;
  className?: string;
  variant?: ButtonVariant;
  width?: ButtonWidth;
  icon?: Icon;
  disabled?: boolean;
  [key: string]: any;
}) {
  const Component = props?.to ? Link : as;

  const baseButtonClasses = `inline-flex items-center rounded-lg font-semibold text-center py-[10px] gap-2 px-4 max-w-xl border text-sm drop-shadow`;

  const variants = {
    primary: `${baseButtonClasses} bg-primary-700 text-white border-primary-700 hover:bg-primary-800 hover:border-primary-800`,
    secondary: `${baseButtonClasses} bg-white border-gray-300 hover:bg-gray-50`,
    tertiary: `${baseButtonClasses} border-b border-primary/10 leading-none pb-1`,
  };

  const widths = {
    auto: "w-auto",
    full: "w-full",
  };

  const disabledStyles = disabled
    ? "pointer-events-none bg-primary-300 border-primary-100"
    : undefined;

  return (
    <Component
      className={`${variants[variant]} ${widths[width]} ${disabledStyles} ${className}`}
      {...props}
    >
      {icon && iconsMap[icon]} <span>{children}</span>
    </Component>
  );
}
