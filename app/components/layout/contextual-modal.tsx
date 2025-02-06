import type { ReactNode } from "react";
import { useCallback } from "react";
import { Outlet, useMatches, useNavigate } from "@remix-run/react";
import { AnimatePresence } from "framer-motion";
import { tw } from "~/utils/tw";
import { XIcon } from "../icons/library";
import { Button } from "../shared/button";

const Dialog = ({
  children,
  open,
  noScroll,
}: {
  children: ReactNode;
  open: boolean;
  noScroll: boolean;
}) => {
  const matches = useMatches();
  const prevRoute = matches[matches.length - 2];

  const navigate = useNavigate();
  const handleBackdropClose = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      navigate(prevRoute);
    },
    [prevRoute, navigate]
  );

  return open ? (
    <div className="dialog-backdrop" onClick={handleBackdropClose}>
      <dialog className="dialog" open={true}>
        <div
          className={tw(
            "relative z-10 size-full  bg-white p-6 shadow-lg md:max-h-[85vh] md:rounded",
            noScroll ? "md:h-[85vh]" : "md:overflow-y-auto"
          )}
        >
          <Button
            to={prevRoute}
            variant="link"
            className={
              "absolute right-4 top-[16px] leading-none text-gray-500 md:right-6 md:top-[26px]"
            }
          >
            <XIcon />
          </Button>
          {children}
        </div>
      </dialog>
    </div>
  ) : null;
};

export default function ContextualModal() {
  const matches = useMatches();
  /** Get the last item which refers to the current route */
  const currentRoute = matches[matches.length - 1];
  const data = currentRoute?.data as {
    showModal?: boolean;
    noScroll?: boolean;
  } | null;
  const showModal = data?.showModal || false;

  // Control whether the modal is scrollable or not
  const noScroll = data?.noScroll || false;

  return (
    <AnimatePresence>
      <Dialog open={showModal} noScroll={noScroll}>
        <Outlet />
      </Dialog>
    </AnimatePresence>
  );
}
