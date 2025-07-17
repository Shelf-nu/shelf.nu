import { tw } from "~/utils/tw";

interface Props {
  children: React.ReactNode;
  className?: string;
}

export default function SubHeading({ children, className }: Props) {
  return (
    <div className={tw(`font-normal text-color-500`, className)}>
      {children}
    </div>
  );
}
