import { tw } from "~/utils";

export const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={tw("my-4 rounded border bg-white px-4 py-5", className)}>
    {children}
  </div>
);
