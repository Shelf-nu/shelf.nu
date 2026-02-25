import type { ReactNode } from "react";
import { tw } from "~/utils/tw";

export const ButtonGroup = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div className={tw("button-group", "inline-flex items-center", className)}>
    {children}
  </div>
);
