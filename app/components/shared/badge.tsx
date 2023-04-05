export const Badge = ({
  children,
  color,
}: {
  children: string;
  color: string;
}) => (
  <span
    style={{
      backgroundColor: `${color}33`, // 30%
      color: `${color}`, // 90%
      mixBlendMode: "multiply",
    }}
    className="inline-flex items-center gap-1 rounded-2xl py-[2px] pl-[6px] pr-2 text-[12px] font-medium"
  >
    <div
      style={{
        backgroundColor: color,
      }}
      className="h-2 w-2 rounded-full"
    />
    <span>{children}</span>
  </span>
);
