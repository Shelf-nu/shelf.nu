import SubHeading from "../shared/sub-heading";

interface Props {
  /** Label to be rendered on the left side of the row */
  rowLabel: string;
  children: React.ReactNode;
  className?: string;
  subHeading?: string;
}

export default function FormRow({
  children,
  rowLabel,
  subHeading,
  className,
}: Props) {
  return (
    <div
      className={`flex gap-8 border-b-[1px] border-y-gray-200 py-6 ${className}`}
    >
      <div className="w-[280px]">
        <div className="text-text-sm font-medium text-gray-700">{rowLabel}</div>
        <SubHeading className="text-text-xs">{subHeading}</SubHeading>
      </div>

      <div className="w-full">{children}</div>
    </div>
  );
}
