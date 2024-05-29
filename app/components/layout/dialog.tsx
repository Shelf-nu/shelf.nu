import { useCallback, type ReactNode } from "react";
import { useMatches, useNavigate } from "@remix-run/react";
import { tw } from "~/utils/tw";
import { XIcon } from "../icons/library";
import { Button } from "../shared/button";

export const Dialog = ({
  children,
  open,
  noScroll,
  onClose,
  title,
}: {
  children: ReactNode;
  open: boolean;
  noScroll: boolean;
  onClose: Function;
  title: string;
}) => {
  const matches = useMatches();
  const prevRoute = matches[matches.length - 2];
  const navigate = useNavigate();
  const handleBackdropClose = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      navigate(prevRoute);
      onClose();
    },
    [prevRoute, navigate, onClose]
  );

  return open ? (
    <div className="dialog-backdrop" onClick={handleBackdropClose}>
      <dialog className="dialog w-full md:w-[90%]" open={true}>
        <div
          className={tw(
            "relative z-10  h-full bg-white pt-4 shadow-lg md:max-h-[85vh] md:rounded",
            noScroll ? "md:h-[90vh]" : "h-full md:overflow-y-auto"
          )}
        >
          <div className="flex h-[10%] justify-between px-6">
            <div>
              <div className=" text-lg font-semibold text-gray-900">
                {title}
              </div>
              <div className="text-sm font-normal text-gray-600">
                1 image(s)
              </div>
            </div>
            <Button
              to={prevRoute}
              variant="link"
              className={"mt-[-10px] leading-none text-gray-500 md:right-6"}
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </div>
          <div className="flex h-4/5 items-center justify-center border-y-2 border-gray-200">
            {children}
          </div>
          <div className="flex h-[10%] w-full justify-center gap-3 px-6 py-3 md:justify-end">
            <div className="flex w-1/2 items-center justify-center rounded border border-gray-300 px-4 py-2 md:w-[10%]">
              <Button
                to={prevRoute}
                variant="link"
                className={"text-center leading-none text-gray-500 md:right-6"}
                onClick={onClose}
              >
                Edit image(s)
              </Button>
            </div>
            <div className="flex w-1/2 items-center justify-center rounded border border-gray-300 px-4 py-2 md:w-[10%]">
              <Button
                to={prevRoute}
                variant="link"
                className={"leading-none text-gray-500 md:right-6"}
                onClick={onClose}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  ) : null;
};
