import type { PropsWithChildren } from "react";
import { tw } from "~/utils/tw";

type GrayBadgeProps = PropsWithChildren<{
  className?: string;
  style?: React.CSSProperties;
}> &
  React.HTMLAttributes<HTMLSpanElement>;

export function GrayBadge({
  className,
  style,
  children,
  ...rest
}: GrayBadgeProps) {
  return (
    <span
      className={tw(
        "inline-flex w-max items-center justify-center rounded-2xl bg-muted px-2 py-[2px] text-center text-[12px] font-medium text-color-700",
        className
      )}
      style={style}
      {...rest}
    >
      {children}
    </span>
  );
}
