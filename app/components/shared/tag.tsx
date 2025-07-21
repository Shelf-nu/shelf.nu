import { tw } from "~/utils/tw";

export const Tag = ({
  children,
  className,
  title,
}: {
  children: string | JSX.Element;
  className?: string;
  title?: string;
}) => (
  <span
    className={tw(
      "mb-1 inline-flex justify-center rounded-2xl bg-muted px-[8px] py-[2px] text-center text-[12px] font-medium text-color-700",
      className
    )}
    title={title}
  >
    {children}
  </span>
);
