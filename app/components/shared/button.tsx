import React from "react";
import { Link } from "@remix-run/react";
import { tw } from "~/utils/tw";
import type { IconType } from "./icons-map";
import Icon from "../icons/icon";
import type { ButtonVariant, ButtonWidth } from "../layout/header/types";

export interface ButtonProps {
  as?: React.ComponentType<any> | string;
  className?: string;
  variant?: ButtonVariant;
  width?: ButtonWidth;
  size?: "sm" | "md";
  icon?: IconType;
  disabled?: boolean;
  attachToInput?: boolean;
  onlyIconOnMobile?: boolean;
  title?: string;
  prefetch?: "none" | "intent" | "render" | "viewport";
  [key: string]: any;
}

export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  function Button(
    {
      as = "button",
      className = "",
      variant = "primary",
      width = "auto",
      size = "sm",
      attachToInput = false,
      icon,
      disabled = undefined,
      children,
      title,
      onlyIconOnMobile,
      error,
      hideErrorText = false,
      ...props
    }: ButtonProps,
    ref
  ) {
    const Component: React.ComponentType<any> | string = props?.to ? Link : as;
    const baseButtonClasses = `inline-flex items-center justify-center rounded font-semibold text-center  gap-2  max-w-xl border text-sm box-shadow-xs`;

    const variants = {
      primary: tw(
        `border-primary-400 bg-primary-500 text-white hover:bg-primary-400 focus:ring-2`,
        disabled ? "border-primary-300 bg-primary-300" : ""
      ),
      secondary: tw(
        `border-gray-300 bg-white text-gray-700 hover:bg-gray-50`,
        disabled ? "text-gray-500" : ""
      ),
      tertiary: tw(
        `border-b border-primary/10 pb-1 leading-none`,
        disabled ? "text-gray-300" : ""
      ),
      link: tw(
        `border-none p-0 text-text-sm font-semibold text-primary-700 hover:text-primary-800`
      ),
    };

    const sizes = {
      xs: tw("px-2 py-[6px] text-xs"),
      sm: tw("px-[14px] py-2"),
      md: tw("px-4 py-[10px]"),
    };

    const widths = {
      auto: "w-auto",
      full: "w-full max-w-full",
    };

    const disabledStyles = disabled
      ? "pointer-events-none opacity-50 cursor-not-allowed"
      : undefined;
    const attachedStyles = attachToInput
      ? tw(" rounded-l-none border-l-0")
      : undefined;

    const finalStyles = tw(
      baseButtonClasses,
      sizes[size],
      variants[variant],
      widths[width],
      disabledStyles,
      attachedStyles,
      className,
      error
        ? "border-error-300 focus:border-error-300 focus:ring-error-100"
        : ""
    );

    return (
      <>
        <Component
          className={finalStyles}
          prefetch={props.to ? (props.prefetch ? "intent" : "none") : "none"}
          {...props}
          title={title}
          ref={ref}
        >
          {icon && <Icon icon={icon} />}{" "}
          {children ? (
            <span className={onlyIconOnMobile ? "hidden lg:inline-block" : ""}>
              {children}
            </span>
          ) : null}
        </Component>
        {!hideErrorText && error && (
          <div className="text-sm text-error-500">{error}</div>
        )}
      </>
    );
  }
);
