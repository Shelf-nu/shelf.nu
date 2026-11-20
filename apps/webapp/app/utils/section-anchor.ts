/**
 * Section Anchors
 *
 * Shared pieces for linkable page sections: the attribute that marks one, the
 * URL that links to one, and the rule that decides which section the reader
 * is on while scrolling.
 *
 * @see {@link file://./../components/shared/card.tsx} - marks anchored cards
 * @see {@link file://./../hooks/use-section-hash-sync.ts} - keeps the hash in step
 */

/** Data attribute on every linkable section; its `id` is the anchor. */
export const SECTION_ANCHOR_ATTRIBUTE = "data-section-anchor";

/**
 * Distance in px from the top of the scroll area that a section's top must
 * reach to count as the one being read. It sits just below the `scroll-mt-4`
 * (16px) a link scrolls a card to, so opening a link always lands on the
 * section it names, however short that section is.
 */
export const SECTION_ACTIVE_LINE = 32;

/** A section's position, relative to the top of the scroll area. */
type SectionPosition = { id: string; top: number; bottom: number };

/**
 * Picks the section the reader is on.
 *
 * It is the last section whose top has scrolled up to the active line. Above
 * the first section, it is none. At the bottom of the page, the sections
 * below the active line can never reach it, so one of them that is already in
 * the hash keeps it while it is in view: a link to one of them stays as
 * opened. A section above the active line's pick never keeps it, so a fast
 * jump to the bottom still moves the hash down.
 *
 * @param args.sections - Linkable sections in document order
 * @param args.currentId - The anchor currently in the URL hash, if any
 * @param args.atBottom - Whether the scroll area cannot scroll further down
 * @param args.viewportHeight - Visible height of the scroll area
 * @returns The anchor id to put in the hash, or null for none
 */
export function resolveSectionInView({
  sections,
  currentId,
  atBottom,
  viewportHeight,
}: {
  sections: SectionPosition[];
  currentId: string | null;
  atBottom: boolean;
  viewportHeight: number;
}): string | null {
  let inView: string | null = null;
  for (const section of sections) {
    if (section.top <= SECTION_ACTIVE_LINE) inView = section.id;
  }

  if (atBottom && currentId) {
    const currentIndex = sections.findIndex((s) => s.id === currentId);
    const current = sections[currentIndex];
    const pickIndex = sections.findIndex((s) => s.id === inView);
    const isVisible =
      current !== undefined &&
      current.top < viewportHeight &&
      current.bottom > 0;
    if (isVisible && currentIndex > pickIndex) return currentId;
  }

  return inView;
}

/**
 * The current page's URL pointing at a section.
 *
 * @param anchorId - The section's id, or null for the page without a hash
 * @param location - The location to start from, `window.location` in the app
 * @returns An absolute URL that keeps the path and query string
 */
export function sectionUrl(
  anchorId: string | null,
  location: Pick<Location, "origin" | "pathname" | "search">
): string {
  const hash = anchorId ? `#${anchorId}` : "";
  return `${location.origin}${location.pathname}${location.search}${hash}`;
}

/**
 * Points the address bar at a section without navigating.
 *
 * `history.replaceState` changes only the visible URL: no loader runs, no
 * history entry is added, and nothing scrolls. React Router's own entry state
 * is passed through so its back/forward bookkeeping stays intact. A router
 * navigation would not do: React Router scrolls to the hash on every location
 * change, which would yank the page while the reader scrolls.
 *
 * @param anchorId - The section's id, or null to drop the hash
 */
export function replaceUrlHash(anchorId: string | null) {
  const current = window.location.hash.slice(1);
  if (current === (anchorId ?? "")) return;
  try {
    window.history.replaceState(
      window.history.state,
      "",
      sectionUrl(anchorId, window.location)
    );
  } catch {
    // Browsers throttle replaceState (Safari throws past ~100 calls in 30s).
    // The hash is a convenience, so a skipped update is fine.
  }
}
