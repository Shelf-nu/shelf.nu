/**
 * Card
 *
 * Bordered white panel that groups one block of content, such as a settings
 * section, plus `CardTitle` for its heading.
 *
 * A card with an `id` is a linkable section: a URL whose hash names it (for
 * example `/settings/bookings#automation`) opens the page scrolled to it,
 * its `CardTitle` shows a copy-link button, and `useSectionHashSync` keeps
 * the URL hash on it while it is the section being read.
 *
 * @see {@link file://./copy-section-link-button.tsx}
 * @see {@link file://./../../hooks/use-section-hash-sync.ts}
 * @see {@link file://./../../utils/settings-card-anchors.ts}
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { SECTION_ANCHOR_ATTRIBUTE } from "~/utils/section-anchor";
import { tw } from "~/utils/tw";
import { CopySectionLinkButton } from "./copy-section-link-button";

/** The anchor id of the card being rendered, or null for a card without one. */
const CardAnchorContext = createContext<string | null>(null);

/**
 * Bordered white panel.
 *
 * @param props.id - Optional anchor id. It makes the card a linkable section:
 *   `scroll-mt-4` keeps a little space above it when a link scrolls to it.
 *   Settings ids live in `~/utils/settings-card-anchors`.
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
    {...(id ? { [SECTION_ANCHOR_ATTRIBUTE]: "" } : {})}
    className={tw(
      "card my-4 scroll-mt-4 overflow-hidden rounded border bg-white px-4 py-3",
      className
    )}
  >
    <CardAnchorContext.Provider value={id ?? null}>
      {children}
    </CardAnchorContext.Provider>
  </div>
);

/**
 * Heading of a card. Inside a card with an `id`, it is followed by a button
 * that copies a link straight to the card.
 *
 * @param props.children - The heading text, also used to name the button
 * @param props.as - Heading level, `h3` by default
 * @param props.className - Classes for the heading element
 * @param props.anchorId - Anchor to link to when the heading is not inside an
 *   anchored `Card` (a section built from a plain element)
 */
export function CardTitle({
  children,
  as: Heading = "h3",
  className,
  anchorId,
}: {
  children: string;
  as?: "h2" | "h3" | "h4";
  className?: string;
  anchorId?: string;
}) {
  const cardAnchorId = useContext(CardAnchorContext);
  const linkTo = anchorId ?? cardAnchorId;

  return (
    <div className="flex items-center gap-1">
      <Heading className={tw("text-text-lg font-semibold", className)}>
        {children}
      </Heading>
      {linkTo ? (
        <CopySectionLinkButton anchorId={linkTo} sectionTitle={children} />
      ) : null}
    </div>
  );
}
