import { JSX } from "react";
import { tw } from "~/utils/tw";

interface Props {
  /** Size of the hug. Defualt is sm */
  size: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";

  children: JSX.Element | JSX.Element[];

  className?: string;
}

/** Because of how tailwind works, we cannot use props to build class names dynamically,
 * so we need to already have the classes inside the string.
 * https://tailwindcss.com/docs/content-configuration#dynamic-class-names  */

const sizeClasses: {
  [key in Props["size"]]: string;
} = {
  /** 16 */
  xs: "w-4 h-4",
  /** 32px */
  sm: "w-5 h-5",
  /** 40px */
  md: "w-10 h-10",
  /** 44px */
  lg: "w-11 h-11",
  /** 48px */
  xl: "w-12 h-12",
  /** 56px */
  "2xl": "w-14 h-14",
};

export default function IconHug({ size = "sm", children, className }: Props) {
  /**
   * Classes that will add the correct class based on the size passed to the hug
   * The value corresponds to rem, related to sizes of untitled ui
   */
  const sizeClass = sizeClasses[size];
  return (
    <span
      className={tw(
        "inline-flex items-center justify-center", //positioning
        "rounded hover:cursor-pointer", //styling
        sizeClass,
        className
      )}
    >
      {children}
    </span>
  );
}
