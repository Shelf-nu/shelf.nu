import type { JSX, ReactNode } from "react";
import { tw } from "~/utils/tw";
import SubHeading from "../shared/sub-heading";

interface Props {
  /** Label to be rendered on the left side of the row */
  rowLabel: string;
  children: ReactNode;
  className?: string;
  subHeading?: string | JSX.Element;
  required?: boolean;
}

export default function FormRow({
  children,
  rowLabel,
  subHeading,
  className,
  required = false,
}: Props) {
  return (
    <div
      className={tw(`flex gap-8 border-b border-y-gray-200 py-6`, className)}
    >
      <div className="hidden lg:block lg:min-w-[280px] lg:basis-[280px]">
        <div
          className={tw(
            "text-text-sm font-medium text-gray-700",
            required && "required-input-label"
          )}
        >
          {rowLabel}
        </div>
        <SubHeading className="text-xs text-gray-600">{subHeading}</SubHeading>
      </div>

      <div className="form-row-children-wrapper relative flex w-[512px] max-w-full flex-wrap">
        {children}
      </div>
    </div>
  );
}
