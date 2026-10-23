import type { ReactNode } from "react";
import { tw } from "~/utils/tw";

export const Card = ({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) => (
  <div
    id={id}
    className={tw(
      "card my-4 overflow-hidden rounded border bg-white px-4 py-3",
      className
    )}
  >
    {children}
  </div>
);
