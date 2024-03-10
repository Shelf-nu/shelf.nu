import { Outlet, useMatches } from "@remix-run/react";
import { AnimatePresence } from "framer-motion";
import { Dialog } from "./dialog";

export default function ContextualModal() {
  const matches = useMatches();
  /** Get the last item which refers to the current route */
  const currentRoute = matches[matches.length - 1];
  const data = currentRoute?.data as {
    showModal?: boolean;
    noScroll?: boolean;
  };
  const showModal = data.showModal || false;
  // Control whether the modal is scrollable or not

  const noScroll = data.noScroll || false;

  return (
    <AnimatePresence>
      <Dialog open={showModal} noScroll={noScroll}>
        <Outlet />
      </Dialog>
    </AnimatePresence>
  );
}
