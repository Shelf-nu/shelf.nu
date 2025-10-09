import type { ReactNode } from "react";
import { darkenColor } from "~/utils/color-contrast";
import { tw } from "~/utils/tw";

export const Badge = ({
  children,
  color,
  textColor,
  noBg = false,
  withDot = true,
  className = "",
}: {
  children: string | ReactNode;
  color: string;
  /**
   * Optional text color. If not provided, will automatically darken the background color.
   * Use this for predefined status badges where you want full control over the color combination.
   * When textColor is provided, the background color is used as-is without opacity.
   */
  textColor?: string;
  noBg?: boolean;
  withDot?: boolean;
  className?: string;
}) => {
  // Use predefined textColor if provided, otherwise darken the color for WCAG AA contrast
  // This allows user-generated colors (categories) to be automatically darkened,
  // while predefined status badges can use hand-picked accessible color combinations
  const finalTextColor = textColor || darkenColor(color, 0.5);

  // When textColor is provided, use the background color as-is (predefined colors)
  // Otherwise, apply 30% opacity for user-generated colors
  const finalBgColor = textColor ? color : `${color}33`;

  return (
    <span
      style={{
        backgroundColor: !noBg ? finalBgColor : undefined,
        color: finalTextColor,
        // Only use mix-blend-mode for auto-generated colors (user categories)
        // Predefined status colors should render as-is
        ...(textColor ? {} : { mixBlendMode: "multiply" }),
      }}
      className={tw(
        "inline-flex items-center rounded-2xl py-[2px] pl-[6px] text-[12px] font-medium",
        withDot ? " gap-1 pr-2" : "px-2",
        className
      )}
    >
      {withDot ? (
        <div
          style={{
            backgroundColor: finalTextColor,
          }}
          className="size-1.5 rounded-full"
        />
      ) : null}

      <span>{children}</span>
    </span>
  );
};
