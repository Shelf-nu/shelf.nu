import type { ReactNode } from "react";
import { useTheme } from "~/hooks/use-theme";
import { tw } from "~/utils/tw";

/**
 * Convert hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

export const Badge = ({
  children,
  color,
  noBg = false,
  withDot = true,
  className = "",
}: {
  children: string | ReactNode;
  color: string;
  noBg?: boolean;
  withDot?: boolean;
  className?: string;
}) => {
  const theme = useTheme();
  
  // Convert hex color to RGB for better control
  const rgb = hexToRgb(color);
  
  // Create appropriate background and text colors based on theme
  const backgroundColor = !noBg && rgb
    ? theme === "dark"
      ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)` // More subtle in dark mode
      : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`   // Light mode
    : undefined;
    
  const textColor = rgb
    ? theme === "dark"
      ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.9)`  // Slightly dimmed in dark mode
      : color                                        // Full color in light mode
    : color;

  return (
    <span
      style={{
        backgroundColor,
        color: textColor,
        // Remove mixBlendMode as it causes issues in dark mode
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
            backgroundColor: color,
          }}
          className="size-1.5 rounded-full"
        />
      ) : null}

      <span>{children}</span>
    </span>
  );
};
