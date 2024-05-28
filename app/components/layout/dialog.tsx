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
  title
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
      <dialog className="dialog w-[90%]" open={true}>
        <div
          className={tw(
            " relative z-10  bg-white pt-4 shadow-lg md:max-h-[85vh] md:rounded",
            noScroll ? "md:h-[90vh]" : "md:overflow-y-auto"
          )}
        >
          <div className="flex pl-6 pr-6 h-[10%] justify-between">
            <div>
              <div className=" text-gray-900 text-lg font-semibold">{title}</div>
              <div className="text-gray-600 font-normal text-sm">1 image(s)</div>
            </div>
            <Button
              to={prevRoute}
              variant="link"
              className={
                "leading-none text-gray-500 md:right-6 mt-[-10px]"
              }
              onClick={onClose}
            >
              <XIcon />
            </Button>
          </div>
          <div className="h-4/5 border-y-2  border-gray-200 flex items-center justify-center">
            {children}
          </div>
          <div className="h-[10%] py-3 px-6 flex justify-end gap-3">
            <div className="border rounded flex items-center px-4 py-2 border-gray-300">
              <Button
                to={prevRoute}
                variant="link"
                className={
                  "leading-none text-gray-500 md:right-6"
                }
                onClick={onClose}
              >
                Edit image(s)
              </Button>
            </div>
            <div className="border rounded flex items-center px-4 py-2 border-gray-300">
              <Button
                to={prevRoute}
                variant="link"
                className={
                  "leading-none text-gray-500 md:right-6"
                }
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
