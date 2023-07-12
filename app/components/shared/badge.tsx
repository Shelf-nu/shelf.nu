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
    className="inline-flex items-center gap-1 rounded-2xl py-[2px] pl-[6px] pr-2 text-[12px] font-medium"
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
