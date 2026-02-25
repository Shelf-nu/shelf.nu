import type { ReactNode } from "react";
import { tw } from "~/utils/tw";

interface Props {
  children: ReactNode;
  className?: string;
}

export default function SubHeading({ children, className }: Props) {
  return (
    <div className={tw(`font-normal text-gray-500`, className)}>{children}</div>
  );
}
