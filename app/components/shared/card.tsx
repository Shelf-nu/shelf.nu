import { tw } from "~/utils/tw";

export const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={tw("card my-4 rounded border bg-white px-4 py-3", className)}>
    {children}
  </div>
);
