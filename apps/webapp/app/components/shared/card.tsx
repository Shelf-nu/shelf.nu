import type { ReactNode } from "react";
import { tw } from "~/utils/tw";

/**
 * Bordered white panel that groups one block of content, such as a settings
 * section.
 *
 * @param props.id - Optional anchor id. A URL whose hash names it (for example
 *   `/settings/bookings#automation`) scrolls to the card; `scroll-mt-4` keeps
 *   a little space above it. Settings ids live in `~/utils/settings-card-anchors`.
 */
export const Card = ({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) => (
  <div
    id={id}
    className={tw(
      "card my-4 scroll-mt-4 overflow-hidden rounded border bg-white px-4 py-3",
      className
    )}
  >
    {children}
  </div>
);
