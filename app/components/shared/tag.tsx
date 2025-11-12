import { JSX } from "react";
import { tw } from "~/utils/tw";

export const Tag = ({
  children,
  className,
  title,
}: {
  children: string | JSX.Element;
  className?: string;
  title?: string;
}) => (
  <span
    className={tw(
      "mb-1 inline-flex justify-center rounded-2xl bg-gray-100 px-[8px] py-[2px] text-center text-[12px] font-medium text-gray-700",
      className
    )}
    title={title}
  >
    {children}
  </span>
);
