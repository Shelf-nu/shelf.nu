import { tw } from "~/utils";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export default function SubHeading({ children, className }: Props) {
  return (
    <div className={tw(`font-normal text-gray-500`, className)}>{children}</div>
  );
}
