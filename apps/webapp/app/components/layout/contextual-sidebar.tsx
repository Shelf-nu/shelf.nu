import { useCallback, useEffect, useState } from "react";
import { Outlet, useMatches, useNavigate } from "react-router";
import { tw } from "~/utils/tw";
import Header from "./header";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "../shared/sheet";

export default function ContextualSidebar({
  className,
}: {
  className?: string;
}) {
  const matches = useMatches();
  const navigate = useNavigate();

  /** Get the last asset which refers to the current route */
  const currentRoute = matches[matches.length - 1];
  /** We need the prev route, as we use it for navigating back/closing the sidebar */
  const prevRoute = matches[matches.length - 2];
  const data = currentRoute?.data as {
    showSidebar?: boolean;
    header: {
      title: string;
      subHeading?: string;
    };
  };
  const showSidebar = data?.showSidebar || false;

  const [open, setOpen] = useState(false);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setOpen(true);
      } else {
        // Check if there's a nested dialog open before closing
        const dialogBackdrops = document.querySelectorAll(".dialog-backdrop");
        // Check for Radix AlertDialog overlays that are actually visible
        const radixOverlays = document.querySelectorAll(
          '[data-radix-alert-dialog-overlay][data-state="open"]'
        );

        // Only navigate away if there's no nested dialog open
        if (dialogBackdrops.length === 0 && radixOverlays.length === 0) {
          void navigate(prevRoute.pathname);
        }
      }
    },
    [navigate, prevRoute.pathname]
  );

  useEffect(() => {
    setOpen(showSidebar);
  }, [showSidebar]);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className={tw(
          "flex w-full border-l-0 bg-surface p-0 md:w-[85vw] md:max-w-[85vw]",
          className
        )}
      >
        {showSidebar && (
          <div className="flex h-screen w-full flex-col">
            {data?.header?.title && (
              <Header
                title={
                  data?.header?.title && (
                    // We render as child with span to avoid nesting of H2
                    <SheetTitle asChild>
                      <span>{data.header.title}</span>
                    </SheetTitle>
                  )
                }
                subHeading={
                  <SheetDescription>{data.header.subHeading}</SheetDescription>
                }
                hideBreadcrumbs
                classNames="text-left mb-3 [&>div]:px-6 mx-0"
              />
            )}

            <div className="h-full flex-1 overflow-hidden scrollbar-thin">
              <Outlet />
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
