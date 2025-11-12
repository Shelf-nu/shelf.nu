import { JSX } from "react";
import { tw } from "~/utils/tw";

export function ListContentWrapper({
  children,
  className,
}: {
  children: JSX.Element | JSX.Element[];
  className?: string;
}) {
  return (
    <div
      className={tw(
        "relative flex flex-1 flex-col md:mx-0 md:mt-4 md:gap-2",
        className
      )}
    >
      {children}
    </div>
  );
}
