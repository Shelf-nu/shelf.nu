import { Link, Outlet, useMatches } from "@remix-run/react";
import { motion, AnimatePresence } from "framer-motion";

export default function ContextualSidebar() {
  const matches = useMatches();
  /** Get the last item which refers to the current route */
  const currentRoute = matches[matches.length - 1];

  /** We need the prev route, as we use it for navigating back/closing the sidebar */
  const prevRoute = matches[matches.length - 2];
  const showSidebar = currentRoute?.data?.showSidebar;

  return (
    <AnimatePresence>
      {showSidebar && (
        <div className="absolute inset-0">
          <motion.div
            key="child"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            className=" absolute inset-0 z-10 h-full w-full bg-black/60"
          >
            <Link to={prevRoute.pathname} className="block h-full w-full">
              {" "}
            </Link>
          </motion.div>

          <motion.div
            className="absolute right-0 z-20 h-full w-3/4"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{
              type: "spring",
              stiffness: 200,
              damping: 30,
              duration: 0.2,
            }}
          >
            <div className=" h-full w-full bg-white p-6">
              <Outlet />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
