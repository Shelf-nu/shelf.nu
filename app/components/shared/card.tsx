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
      "card my-4 border-y bg-white px-4 py-5 md:rounded md:border",
      className
    )}
  >
    {children}
  </div>
);
