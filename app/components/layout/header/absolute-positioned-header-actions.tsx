import { tw } from "~/utils/tw";

/** Use this component within a module show view to place buttons in the header visually outside the form */
export const AbsolutePositionedHeaderActions = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={tw(
      " flex w-screen max-w-full items-center justify-between bg-surface py-2 md:absolute md:right-0 md:top-3 md:m-0 md:w-fit md:justify-end md:border-0 md:bg-transparent md:p-0",
      className
    )}
  >
    <div className=" flex flex-1 gap-2">{children}</div>
  </div>
);
