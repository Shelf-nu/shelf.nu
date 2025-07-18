import { tw } from "~/utils/tw";

export const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={tw(
      "card my-4 overflow-hidden rounded border bg-surface px-4 py-3 dark:border-color-300",
      className
    )}
  >
    {children}
  </div>
);
