import type { PropsWithChildren } from "react";
import { tw } from "~/utils/tw";

type GrayBadgeProps = PropsWithChildren<{
  className?: string;
  style?: React.CSSProperties;
}>;

export function GrayBadge({ className, style, children }: GrayBadgeProps) {
  return (
    <span
      className={tw(
        "inline-flex w-max items-center justify-center rounded-2xl bg-gray-100 px-2 py-[2px] text-center text-[12px] font-medium text-gray-700",
        className
      )}
      style={style}
    >
      {children}
    </span>
  );
}
