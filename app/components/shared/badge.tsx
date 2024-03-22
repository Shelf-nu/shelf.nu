import type { ReactNode } from "react";
import { tw } from "~/utils/tw";

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
}) => (
  <span
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
