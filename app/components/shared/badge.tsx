import type { ReactNode, Ref, HTMLAttributes } from "react";
import { forwardRef } from "react";
import { tw } from "~/utils/tw";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: string | ReactNode;
  color: string;
  noBg?: boolean;
  withDot?: boolean;
  className?: string;
}

export const Badge = forwardRef(
  (
    {
      children,
      color,
      noBg = false,
      withDot = true,
      className = "",
      ...rest
    }: BadgeProps,
    ref: Ref<HTMLSpanElement>
  ) => (
    <span
      ref={ref}
      style={{
        backgroundColor: !noBg ? `${color}33` : undefined, // 30%
        color: `${color}`, // 90%
        mixBlendMode: "multiply",
      }}
      className={tw(
        "inline-flex items-center rounded-2xl py-[2px] pl-[6px] text-[12px] font-medium",
        withDot ? " gap-1 pr-2" : "px-2",
        className
      )}
      {...rest}
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
  )
);

// Add display name for better debugging
Badge.displayName = "Badge";
