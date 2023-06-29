import React from "react";
import { tw } from "~/utils";
import SubHeading from "../shared/sub-heading";

interface Props {
  /** Label to be rendered on the left side of the row */
  rowLabel: string;
  children: React.ReactNode;
  className?: string;
  subHeading?: string | JSX.Element;
}

export default function FormRow({
  children,
  rowLabel,
  subHeading,
  className,
}: Props) {
  return (
    <div
      className={tw(
        `flex gap-8 border-b-[1px] border-y-gray-200 py-6`,
        className
      )}
    >
      <div className="hidden lg:block lg:basis-[280px]">
        <div className="text-text-sm font-medium text-gray-700">{rowLabel}</div>
        <SubHeading className="text-text-xs text-gray-600">
          {subHeading}
        </SubHeading>
      </div>

      <div className="flex w-[512px]">{children}</div>
    </div>
  );
}
