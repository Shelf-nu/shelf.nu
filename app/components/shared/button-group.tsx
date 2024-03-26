import { tw } from "~/utils/tw";

export const ButtonGroup = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={tw("button-group", "inline-flex items-center", className)}>
    {children}
  </div>
);
