import { tw } from "~/utils";

export const Badge = ({
  children,
  color,
  noBg = false,
  withDot = true,
}: {
  children: string;
  color: string;
  noBg?: boolean;
  withDot?: boolean;
}) => (
  <span
    style={{
      backgroundColor: !noBg ? `${color}33` : undefined, // 30%
      color: `${color}`, // 90%
      mixBlendMode: "multiply",
    }}
    className={tw(
      "inline-flex items-center rounded-2xl py-[1px] pl-[6px] text-[12px] font-medium",
      withDot ? " gap-1 pr-2" : "px-2"
    )}
  >
    {withDot ? (
      <div
        style={{
          backgroundColor: color,
        }}
        className="h-2 w-2 rounded-full"
      />
    ) : null}

    <span>{children}</span>
  </span>
);
