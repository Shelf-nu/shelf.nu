/**
 * useSectionHashSync
 *
 * Makes a page's linkable sections behave like anchors, in both directions:
 *
 * - **Arriving.** When the page opens at a section's hash, scrolls it into
 *   view and moves keyboard focus to it, so Tab continues from the section
 *   instead of the top of the page. React Router's `ScrollRestoration` cannot
 *   do this here: it only scrolls the window, while the app scrolls inside
 *   `main#main-content`, and on a full page load the app layout renders a
 *   spinner until hydration, so the section is not there when it looks. This
 *   hook mounts with the page content, so the section exists when it runs.
 *   Back and Forward bring the entry's section into view too, without moving
 *   focus: the reading half below keeps each entry's hash on the section that
 *   was in view when the reader left it, so that puts them back in place.
 * - **Reading.** Keeps the URL hash on the section the reader is looking at,
 *   so the address bar is always a link to the current spot: scroll to the
 *   Automation card on `/settings/bookings` and the URL becomes
 *   `/settings/bookings#automation`; scroll back above the first card and the
 *   hash goes away. A refresh then reopens the page at the same section.
 *
 * Sections are the elements marked with `SECTION_ANCHOR_ATTRIBUTE` (every
 * `Card` with an `id`) inside the app's scroll area, `<main id="main-content">`.
 * The hash only changes on a scroll event, so a page opened from a link keeps
 * the link's hash until the reader scrolls.
 *
 * @see {@link file://./../utils/section-anchor.ts} - which section counts as in view
 * @see {@link file://./../routes/_layout+/settings.tsx} - mounts it for every settings tab
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";
import {
  SECTION_ANCHOR_ATTRIBUTE,
  replaceUrlHash,
  resolveSectionInView,
} from "~/utils/section-anchor";

/** The id of the app's scroll area (`SidebarInset`). */
const SCROLL_AREA_ID = "main-content";

/** Slack in px for "scrolled to the bottom", to absorb sub-pixel rounding. */
const BOTTOM_SLACK = 2;

/** Selector for every linkable section. */
const SECTION_SELECTOR = `[${SECTION_ANCHOR_ATTRIBUTE}][id]`;

/**
 * Brings the section named by the router's hash into view and, unless told
 * otherwise, gives it keyboard focus. Does nothing when the hash names no
 * section.
 *
 * @param hash - The router location's hash, `#` included
 * @param options.focus - Whether to move keyboard focus to the section
 */
function arriveAtSection(hash: string, { focus }: { focus: boolean }) {
  const id = hash.slice(1);
  if (!id) return;
  const section = document.getElementById(id);
  if (!section?.hasAttribute(SECTION_ANCHOR_ATTRIBUTE)) return;

  section.scrollIntoView({ block: "start" });
  if (!focus) return;
  // A card is not focusable by itself; -1 lets a script focus it without
  // adding it to the Tab order.
  if (!section.hasAttribute("tabindex")) section.tabIndex = -1;
  section.focus({ preventScroll: true });
}

/**
 * Scrolls to and focuses the linked section on arrival, and updates the URL
 * hash as the reader scrolls through linkable sections. Mount it once on a
 * page (or layout) whose content has anchored cards.
 */
export function useSectionHashSync() {
  const { key, hash } = useLocation();
  const navigationType = useNavigationType();
  const hasArrived = useRef(false);

  // Arriving: the first render of the page and every in-app link move focus
  // to the section. Back and Forward only bring it into view: the reader did
  // not ask to go to it, they are returning to where they were.
  useEffect(() => {
    const isFirstArrival = !hasArrived.current;
    hasArrived.current = true;
    const isHistoryStep = !isFirstArrival && navigationType === "POP";
    arriveAtSection(hash, { focus: !isHistoryStep });
  }, [key, hash, navigationType]);

  // Reading: follow the scroll.
  useEffect(() => {
    const scrollArea = document.getElementById(SCROLL_AREA_ID);
    if (!scrollArea) return;

    let frame = 0;
    // The section list changes only when the page's content does (a tab
    // switch, a card shown or hidden), so it is re-read on DOM changes rather
    // than on every scroll frame.
    let sections: HTMLElement[] | null = null;
    const observer = new MutationObserver(() => {
      sections = null;
    });
    observer.observe(scrollArea, { childList: true, subtree: true });

    function sync() {
      frame = 0;
      if (!scrollArea) return;

      sections ??= Array.from(
        scrollArea.querySelectorAll<HTMLElement>(SECTION_SELECTOR)
      );
      // A page without sections (a team list, say) never touches the hash.
      if (sections.length === 0) return;

      const currentId = window.location.hash.slice(1) || null;
      if (currentId && !sections.some((section) => section.id === currentId)) {
        // A hash that names something else in the page content (not a
        // section) belongs to that element; leave it alone. A hash naming the
        // scroll area itself (the "Skip to content" link) or nothing at all
        // is fair to replace.
        const target = document.getElementById(currentId);
        if (target && target !== scrollArea && scrollArea.contains(target)) {
          return;
        }
      }

      const areaTop = scrollArea.getBoundingClientRect().top;
      const positions = sections.map((section) => {
        const rect = section.getBoundingClientRect();
        return {
          id: section.id,
          top: rect.top - areaTop,
          bottom: rect.bottom - areaTop,
        };
      });

      replaceUrlHash(
        resolveSectionInView({
          sections: positions,
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
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
