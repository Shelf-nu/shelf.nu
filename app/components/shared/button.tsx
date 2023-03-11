import { Link } from "@remix-run/react";

export function Button({
  as = "button",
  className = "",
  variant = "primary",
  width = "auto",
  children,
  ...props
}: {
  as?: React.ElementType;
  className?: string;
  variant?: "primary" | "secondary" | "tertiary";
  width?: "auto" | "full";
  icon?: JSX.Element;
  [key: string]: any;
}) {
  const Component = props?.to ? Link : as;

  const baseButtonClasses =
    "inline-block rounded-lg font-semibold text-center py-3 px-6 max-w-xl border text-sm";

  const variants = {
    primary: `${baseButtonClasses} bg-primary-600 text-white border-primary-600`,
    secondary: `${baseButtonClasses} bg-white  border-gray-300`,
    tertiary: "border-b border-primary/10 leading-none pb-1",
  };

  const widths = {
    auto: "w-auto",
    full: "w-full",
  };

  return (
    <Component
      className={`${variants[variant]} ${widths[width]}  ${className}`}
      {...props}
    >
      {children}
    </Component>
  );
}
