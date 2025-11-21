import React from "react";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { Link, type LinkProps } from "@remix-run/react";
import { tw } from "~/utils/tw";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "./hover-card";
import type { IconType } from "./icons-map";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./tooltip";
import Icon from "../icons/icon";
import type { ButtonVariant, ButtonWidth } from "../layout/header/types";

/**
 * Type for the disabled prop that can either be a boolean or an object with additional info
 */
export type DisabledProp =
  | boolean
  | {
      title?: string;
      reason: React.ReactNode | string;
    };

/**
 * Defines valid button size options
 */
export type ButtonSize = "xs" | "sm" | "md";
/**
 * Common button props that all button types share
 */
export interface CommonButtonProps {
  className?: string;
  variant?: ButtonVariant;
  width?: ButtonWidth;
  size?: ButtonSize;
  icon?: IconType;
  attachToInput?: boolean;
  onlyIconOnMobile?: boolean;
  /**
   * If true, and target="_blank", the icon will only be shown on hover
   * This is useful for links that open in a new tab, to avoid showing the icon
   * when the link is not hovered.
   */
  onlyNewTabIconOnHover?: boolean;
  error?: string;
  hideErrorText?: boolean;
  children?: React.ReactNode;
  disabled?: DisabledProp;
  /**
   * Accessible label for the button. Only required for icon-only buttons.
   * Buttons with text children automatically use the text as the accessible name.
   * If both label and text children are present, the text children take precedence.
   */
  label?: string;
  id?: string; // Add id as an optional prop since some buttons might need it
  /**
   * Tooltip text for the button. Also serves as an accessible name for icon-only buttons.
   */
  tooltip?: string;
}

/**
 * Props specific to HTML button elements
 */
export interface HTMLButtonProps
  extends Omit<CommonButtonProps, "disabled" | "title">,
    Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      keyof CommonButtonProps | "disabled"
    > {
  as?: "button";
  to?: never;
  disabled?: DisabledProp;
}

/**
 * Props specific to Link components
 */
export interface LinkButtonProps
  extends CommonButtonProps,
    Omit<LinkProps, keyof CommonButtonProps | "disabled"> {
  as?: typeof Link;
  to: string;
  target?: string;
  prefetch?: "none" | "intent" | "render" | "viewport";
}

/**
 * Props for custom component buttons
 */
export interface CustomComponentButtonProps extends CommonButtonProps {
  as: React.ComponentType<any>;
  [key: string]: any;
}

/**
 * Union type of all possible button prop combinations
 */
export type ButtonProps =
  | HTMLButtonProps
  | LinkButtonProps
  | CustomComponentButtonProps;
/**
 * Type guard to check if props are for a Link button
 */
function isLinkProps(props: ButtonProps): props is LinkButtonProps {
  return "to" in props;
}

/**
 * Style mappings for button variants
 */
const variants: Record<ButtonVariant, string> = {
  primary: tw(
    `border-primary-400 bg-primary-500 text-white focus:ring-2`,
    "disabled:border-primary-300 disabled:bg-primary-300",
    "enabled:hover:bg-primary-400"
  ),
  secondary: tw(
    `border-gray-300 bg-white text-gray-700`,
    "disabled:text-gray-500",
    "[&:is(button:enabled)]:hover:bg-gray-50",
    "[&:is(a)]:hover:bg-gray-50"
  ),
  tertiary: tw(
    `border-b border-primary/10 pb-1 leading-none`,
    "disabled:text-gray-300"
  ),
  link: tw(
    `border-none p-0 text-text-sm font-semibold text-primary-700 hover:text-primary-800`
  ),
  "link-gray": tw(
    "text-gray border-none p-0 text-text-sm font-normal underline hover:text-gray-500 "
  ),
  "block-link": tw(
    "-mt-1 border-none px-2 py-1 text-[14px] font-normal hover:bg-primary-50 hover:text-primary-600"
  ),
  "block-link-gray": tw(
    "-mt-1 border-none px-2 py-1 text-[14px] font-normal hover:bg-gray-50 hover:text-gray-600"
  ),
  danger: tw(
    `border-error-600 bg-error-600 text-white focus:ring-2`,
    "disabled:border-error-300 disabled:bg-error-300",
    "enabled:hover:bg-error-800"
  ),
  info: "bg-blue-500 text-white hover:bg-blue-400 focus:ring-2 disabled:bg-blue-300",
  inherit: tw(
    "font-inherit m-0 inline border-none bg-transparent p-0 text-inherit hover:underline"
  ),
};

const textualVariants = new Set<ButtonVariant>([
  "link",
  "link-gray",
  "block-link",
  "block-link-gray",
]);

/**
 * Style mappings for button sizes
 */
const sizes: Record<ButtonSize, string> = {
  xs: tw("px-2 py-[6px] text-xs"),
  sm: tw("px-[14px] py-2"),
  md: tw("px-4 py-[10px]"),
};

/**
 * Style mappings for button widths
 */
const widths: Record<ButtonWidth, string> = {
  auto: "w-auto",
  full: "w-full max-w-full",
};

/**
 * Button component that supports multiple variants, sizes, and can render as different elements
 */
export const Button = React.forwardRef<HTMLElement, ButtonProps>(
  function Button(
    {
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
      onlyNewTabIconOnHover = false,
      error,
      hideErrorText = false,
      tooltip,
      label,
      ...props
    },
    ref
  ) {
    const Component = isLinkProps(props) ? Link : as;
    const baseButtonClasses =
      variant === "inherit"
        ? "inline-flex items-center"
        : textualVariants.has(variant as ButtonVariant)
          ? "inline-flex items-start justify-start gap-2 text-left max-w-xl"
          : "inline-flex items-center justify-center rounded font-semibold text-center gap-2 max-w-xl border text-sm box-shadow-xs";

    const isDisabled =
      typeof disabled === "boolean" ? disabled : disabled !== undefined;
    const disabledReason =
      typeof disabled === "object" ? disabled.reason : undefined;
    const disabledTitle =
      typeof disabled === "object" ? disabled.title : undefined;

    // Check if this is an icon-only button (has icon but no text children)
    // Also handles empty strings and whitespace-only children
    const isIconOnly =
      icon && (!children || (typeof children === "string" && !children.trim()));

    // Only set aria-label for icon-only buttons or when explicitly provided
    // Buttons with text children don't need aria-label (text is the accessible name)
    const explicitAriaLabel =
      "aria-label" in props
        ? (props["aria-label" as keyof typeof props] as string)
        : undefined;
    const ariaLabel = explicitAriaLabel || (isIconOnly ? label : undefined);

    // Development warning for icon-only buttons without accessible names
    if (
      process.env.NODE_ENV === "development" &&
      isIconOnly &&
      !ariaLabel &&
      !tooltip
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        "Button: Icon-only button detected without accessible name. " +
          "Please provide either an aria-label, label prop, or tooltip for accessibility."
      );
    }

    // Type guard for checking if props has target property
    const hasTarget = (props: ButtonProps): props is LinkButtonProps =>
      "target" in props;
    const newTab = hasTarget(props) && props.target === "_blank";

    const buttonContent = (
      <>
        {icon && <Icon icon={icon} />}
        {children && (
          <span
            className={tw(
              newTab ? "inline-flex items-center gap-[2px]" : "",
              onlyIconOnMobile ? "hidden lg:inline-block" : "",
              newTab && onlyNewTabIconOnHover ? "hover-parent " : ""
            )}
          >
            <style>{`
              .hover-parent:hover .external-link-icon {
                display: inline-flex !important;
              }
            `}</style>

            <span>{children}</span>
            {newTab && (
              <ExternalLinkIcon
                className={tw(
                  "external-link-icon mt-px",
                  onlyNewTabIconOnHover ? "hidden" : "inline-flex"
                )}
              />
            )}
          </span>
        )}
      </>
    );

    const finalStyles = tw(
      baseButtonClasses,
      variant !== "inherit" && sizes[size as ButtonSize],
      variants[variant as ButtonVariant],
      variant !== "inherit" && widths[width as ButtonWidth],
      isDisabled && "cursor-not-allowed opacity-50",
      attachToInput && "rounded-l-none border-l-0",
      error && "border-error-300 focus:border-error-300 focus:ring-error-100",
      className
    );

    // Render disabled button with hover card
    if (isDisabled && disabledReason) {
      return (
        <HoverCard openDelay={50} closeDelay={50}>
          <HoverCardTrigger className="disabled cursor-not-allowed" asChild>
            <Component
              {...props}
              className={finalStyles}
              aria-label={ariaLabel}
              onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
              onClick={(e: React.MouseEvent) => e.preventDefault()}
            >
              {buttonContent}
            </Component>
          </HoverCardTrigger>
          <HoverCardContent side="left">
            <h5 className="text-left text-[14px]">
              {disabledTitle || "Action disabled"}
            </h5>
            <p className="text-left text-[14px]">{disabledReason}</p>
          </HoverCardContent>
        </HoverCard>
      );
    }

    if (tooltip) {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Component
                {...props}
                className={finalStyles}
                aria-label={ariaLabel}
                prefetch={
                  isLinkProps(props) ? (props.prefetch ?? "none") : undefined
                }
                ref={ref}
                disabled={isDisabled}
                /** In the case when the button is disabled but there is no disabled reason, we still need to handle these events */
                {...(isDisabled && {
                  onClick: (e: React.MouseEvent) => e.preventDefault(),
                  onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
                })}
              >
                {buttonContent}
              </Component>
            </TooltipTrigger>

            <TooltipContent side="top" className="max-w-[400px]">
              <p className="text-sm">{tooltip}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    // Render normal button
    return (
      <>
        <Component
          {...props}
          className={finalStyles}
          aria-label={ariaLabel}
          prefetch={isLinkProps(props) ? (props.prefetch ?? "none") : undefined}
          ref={ref}
          disabled={isDisabled}
          /** In the case when the button is disabled but there is no disabled reason, we still need to handle these events */
          {...(isDisabled && {
            onClick: (e: React.MouseEvent) => e.preventDefault(),
            onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
          })}
        >
          {buttonContent}
        </Component>
        {!hideErrorText && error && (
          <div className="text-sm text-error-500">{error}</div>
        )}
      </>
    );
  }
);

Button.displayName = "Button";
