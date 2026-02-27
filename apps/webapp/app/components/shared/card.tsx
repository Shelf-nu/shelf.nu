import type { ReactNode } from "react";
import { tw } from "~/utils/tw";

export const Card = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={tw(
      "card my-4 overflow-hidden rounded border bg-surface px-4 py-3 dark:border-color-300",
      className
    )}
  >
    {children}
  </div>
);
