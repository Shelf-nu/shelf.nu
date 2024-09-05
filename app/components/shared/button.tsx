import React from "react";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Link } from "@remix-run/react";
import { tw } from "~/utils/tw";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import type { IconType } from "./icons-map";
import Icon from "../icons/icon";
import type { ButtonVariant, ButtonWidth } from "../layout/header/types";

export interface ButtonProps {
  as?: React.ComponentType<any> | string;
  className?: string;
  variant?: ButtonVariant;
  width?: ButtonWidth;
  size?: "xs" | "sm" | "md";
  icon?: IconType;
  /** Disabled can be a boolean  */
  disabled?:
    | boolean
    | {
        title?: string;
        reason: React.ReactNode | string;
      };
  attachToInput?: boolean;
  onlyIconOnMobile?: boolean;
  title?: string;
  prefetch?: "none" | "intent" | "render" | "viewport";
  [key: string]: any;
}

export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  function Button(props: ButtonProps, ref) {
    let {
      as = "button",
      className,
      variant = "primary",
      width = "auto",
      size = "sm",
      attachToInput = false,
      icon,
      disabled,
      children,
      onlyIconOnMobile,
      error,
      hideErrorText = false,
      target,
    } = props;
    const Component: React.ComponentType<any> | string = props?.to ? Link : as;
    const baseButtonClasses = `inline-flex  items-center justify-center rounded font-semibold text-center  gap-2  max-w-xl border text-sm box-shadow-xs`;

    const variants = {
      primary: tw(
        `border-primary-400 bg-primary-500 text-white  focus:ring-2`,
        disabled ? "border-primary-300 bg-primary-300" : "hover:bg-primary-400"
      ),
      secondary: tw(
        `border-gray-300 bg-white text-gray-700 `,
        disabled ? "text-gray-500" : "hover:bg-gray-50"
      ),
      tertiary: tw(
        `border-b border-primary/10 pb-1 leading-none`,
        disabled ? "text-gray-300" : ""
      ),
      link: tw(
        `border-none p-0 text-text-sm font-semibold text-primary-700 hover:text-primary-800`
      ),
      "block-link": tw(
        "-mt-1 border-none px-2 py-1 text-[14px] font-normal hover:bg-primary-50 hover:text-primary-600"
      ),

      "block-link-gray": tw(
        "-mt-1 border-none px-2 py-1 text-[14px] font-normal hover:bg-gray-50 hover:text-gray-600"
      ),
      danger: tw(
        `border-error-600 bg-error-600 text-white focus:ring-2`,
        disabled ? "border-error-300 bg-error-300" : "hover:bg-error-800"
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
      ? "opacity-50 cursor-not-allowed"
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

    const isDisabled =
      disabled === undefined // If it is undefined, then it is not disabled
        ? false
        : typeof disabled === "boolean"
        ? disabled
        : true; // If it is an object, then it is disabled
    const reason = typeof disabled === "object" ? disabled.reason : "";
    const disabledTitle =
      typeof disabled === "object" ? disabled.title : undefined;

    const newTab = target === "_blank";

    if (isDisabled) {
      return (
        <HoverCard openDelay={50} closeDelay={50}>
          <HoverCardTrigger
            className={tw("disabled  cursor-not-allowed ")}
            asChild
          >
            <Component
              {...props}
              className={finalStyles}
              onMouseDown={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
              onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                e.preventDefault();
              }}
            >
              {icon && <Icon icon={icon} />}{" "}
              {children ? (
                <span
                  className={onlyIconOnMobile ? "hidden lg:inline-block" : ""}
                >
                  {children}
                </span>
              ) : null}
            </Component>
          </HoverCardTrigger>
          {reason && (
            <HoverCardContent side="left">
              <h5 className="text-left text-[14px]">
                {disabledTitle ? disabledTitle : "Action disabled"}
              </h5>
              <p className="text-left text-[14px]">{reason}</p>
            </HoverCardContent>
          )}
        </HoverCard>
      );
    }
    return (
      <>
        <Component
          {...props}
          className={finalStyles}
          prefetch={props.to ? (props.prefetch ? "intent" : "none") : "none"}
          ref={ref}
        >
          {icon && <Icon icon={icon} />}{" "}
          {children ? (
            <span
              className={tw(
                newTab ? "inline-flex items-center gap-[2px]" : "",
                onlyIconOnMobile ? "hidden lg:inline-block" : ""
              )}
            >
              <span>{children}</span>{" "}
              {newTab && (
                <ExternalLinkIcon className="external-link-icon mt-px" />
              )}
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
