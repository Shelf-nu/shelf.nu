/**
 * useSectionHashSync
 *
 * Keeps the URL hash on the section the reader is looking at, so the address
 * bar is always a link to the current spot: scroll to the Automation card on
 * `/settings/bookings` and the URL becomes `/settings/bookings#automation`;
 * scroll back above the first card and the hash goes away. A refresh then
 * reopens the page at the same section.
 *
 * Sections are the elements marked with `SECTION_ANCHOR_ATTRIBUTE` (every
 * `Card` with an `id`) inside the app's scroll area, `<main id="main-content">`.
 * The hash only changes on a scroll event, so a page opened from a link keeps
 * the link's hash until the reader scrolls.
 *
 * @see {@link file://./../utils/section-anchor.ts} - which section counts as in view
 * @see {@link file://./../routes/_layout+/settings.tsx} - mounts it for every settings tab
 */
import { useEffect } from "react";
import {
  SECTION_ANCHOR_ATTRIBUTE,
  replaceUrlHash,
  resolveSectionInView,
} from "~/utils/section-anchor";

/** The id of the app's scroll area (`SidebarInset`). */
const SCROLL_AREA_ID = "main-content";

/** Slack in px for "scrolled to the bottom", to absorb sub-pixel rounding. */
const BOTTOM_SLACK = 2;

/**
 * Updates the URL hash as the reader scrolls through linkable sections.
 * Mount it once on a page (or layout) whose content has anchored cards.
 */
export function useSectionHashSync() {
  useEffect(() => {
    const scrollArea = document.getElementById(SCROLL_AREA_ID);
    if (!scrollArea) return;

    let frame = 0;

    function sync() {
      frame = 0;
      if (!scrollArea) return;

      const elements = Array.from(
        scrollArea.querySelectorAll<HTMLElement>(
          `[${SECTION_ANCHOR_ATTRIBUTE}][id]`
        )
      );
      // A page without sections (a team list, say) never touches the hash.
      if (elements.length === 0) return;

      const ids = elements.map((element) => element.id);
      const currentId = window.location.hash.slice(1) || null;
      // A hash that names something other than a section belongs to someone
      // else; leave it alone.
      if (currentId && !ids.includes(currentId)) return;

      const areaTop = scrollArea.getBoundingClientRect().top;
      const sections = elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          id: element.id,
          top: rect.top - areaTop,
          bottom: rect.bottom - areaTop,
        };
      });

      replaceUrlHash(
        resolveSectionInView({
          sections,
          currentId,
          atBottom:
            scrollArea.scrollTop + scrollArea.clientHeight >=
            scrollArea.scrollHeight - BOTTOM_SLACK,
          viewportHeight: scrollArea.clientHeight,
        })
      );
    }

    // One measurement per frame, however many scroll events arrive.
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(sync);
    }

    scrollArea.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollArea.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
