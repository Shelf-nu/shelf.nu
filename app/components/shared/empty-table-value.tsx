import type { HTMLAttributes } from "react";

import { tw } from "~/utils/tw";

export function EmptyTableValue({
  label = "No data",
  symbol = "—",
  className,
  ...rest
}: {
  label?: string;
  symbol?: string;
} & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      aria-label={label}
      className={tw("inline-flex items-center text-sm text-gray-400", className)}
      {...rest}
    >
      <span aria-hidden="true">{symbol}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
