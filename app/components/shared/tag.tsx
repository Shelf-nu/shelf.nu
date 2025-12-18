import { forwardRef } from "react";
import type { HTMLAttributes, ReactNode } from "react";
import { darkenColor } from "~/utils/color-contrast";
import { tw } from "~/utils/tw";

type TagProps = HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode;
  color?: string;
  withDot?: boolean;
};

export const Tag = forwardRef<HTMLSpanElement, TagProps>(function Tag(
  { children, className, color, withDot = false, ...props },
  ref
) {
  const hasColor = Boolean(color);
  const finalTextColor = hasColor && color ? darkenColor(color, 0.5) : null;
  const finalBgColor = hasColor && color ? `${color}33` : null;

  return (
    <span
      ref={ref}
      className={tw(
        "inline-flex items-center rounded-2xl bg-gray-100 py-[2px] pl-[6px] text-[12px] font-medium text-gray-700",
        withDot ? " gap-1 pr-2" : "px-2",
        className
      )}
      style={
        hasColor
          ? {
              backgroundColor: finalBgColor ?? undefined,
              color: finalTextColor ?? undefined,
              mixBlendMode: "multiply",
            }
          : undefined
      }
      {...props}
    >
      {withDot ? (
        <span
          className="size-1.5 rounded-full"
          style={{
            backgroundColor: finalTextColor ?? "currentColor",
          }}
        />
      ) : null}
      {children}
    </span>
  );
});
