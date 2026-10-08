import * as React from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import * as HoverCardPrimitive from "@radix-ui/react-hover-card";
import { tw } from "~/utils/tw";

const HoverCard = HoverCardPrimitive.Root;

const HoverCardTrigger = HoverCardPrimitive.Trigger;

const HoverCardContent = React.forwardRef<
  ElementRef<typeof HoverCardPrimitive.Content>,
  ComponentPropsWithoutRef<typeof HoverCardPrimitive.Content>
>(function HoverCardContent(
  { className, align = "center", sideOffset = 4, side = "bottom", ...props },
  ref
) {
  return (
    // why: without a portal the content renders inline and gets clipped by
    // overflow-hidden/auto ancestors (e.g. disabled-reason buttons inside the
    // horizontally scrollable list table). Matches the shared Tooltip, which
    // already portals its content.
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        side={side}
        className={tw(
          // z-[999999]: the repo's "above everything" layer (same as the shared
          // date pickers). Portalled content leaves the trigger's stacking
          // context, so it competes with dialogs/modals at z-[100] — at z-50 a
          // hover card opened inside a dialog renders BEHIND that dialog.
          "z-[999999] w-64 rounded-md border bg-white px-4 py-3 shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
});

export { HoverCard, HoverCardTrigger, HoverCardContent };
