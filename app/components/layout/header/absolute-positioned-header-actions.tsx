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
      " -mx-4 flex w-screen items-center justify-between bg-white px-4 py-2 md:absolute md:right-4 md:top-3 md:m-0 md:w-fit md:justify-end md:border-0 md:bg-transparent md:p-0",
      className
    )}
  >
    <div className=" flex flex-1 gap-2">{children}</div>
  </div>
);
