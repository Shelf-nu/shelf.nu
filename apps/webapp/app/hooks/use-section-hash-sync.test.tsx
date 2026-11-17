/**
 * Tests for useSectionHashSync: opening a page at a section brings that
 * section into view and focus, and the URL hash follows the section being
 * read.
 *
 * happy-dom does no layout, so each section's position is set by hand
 * through `getBoundingClientRect`, the one layout read the hook makes, and
 * the scroll area's size through `clientHeight` / `scrollHeight` /
 * `scrollTop`.
 *
 * @see {@link file://./use-section-hash-sync.ts}
 */
import { useEffect, useState } from "react";
import { act, render } from "@testing-library/react";
import {
  createMemoryRouter,
  Outlet,
  RouterProvider,
  ScrollRestoration,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Card } from "~/components/shared/card";
import { useSectionHashSync } from "./use-section-hash-sync";

/** Top of each section relative to the scroll area, set per test. */
const tops: Record<string, number> = {};

/** Ids of the elements `scrollIntoView` was called on, in order. */
const scrolledTo: string[] = [];

/** The settings layout: the hook, then the page. */
function SettingsLayout() {
  useSectionHashSync();
  return <Outlet />;
}

function BookingsPage() {
  return (
    <>
      <Card id="notifications">Notifications</Card>
      <Card id="automation">Automation</Card>
      <div id="faq">A heading some other feature links to</div>
    </>
  );
}

function TeamPage() {
  return <p>Team list</p>;
}

/**
 * The app layout: like the real one, it shows a spinner on the first render
 * and the page one pass later, so nothing a link names exists when React
 * Router's ScrollRestoration first looks for it.
 */
function AppLayout() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated ? <Outlet /> : <p>Activating workspace...</p>;
}

function Root({ restoreScroll }: { restoreScroll: boolean }) {
  return (
    <>
      {restoreScroll ? <ScrollRestoration /> : null}
      <Outlet />
    </>
  );
}

/**
 * Renders the app at `url` inside the app's scroll area.
 *
 * @param url - Where the page opens, hash included
 * @param size - The scroll area's measurements; by default a tall page in a
 *   normal window, so the reader is never at the bottom
 * @param restoreScroll - Whether React Router's ScrollRestoration runs too, as
 *   in the app. Off when a test counts only the hook's own scrolls.
 */
async function openPage(
  url: string,
  size = { clientHeight: 800, scrollHeight: 5000, scrollTop: 0 },
  restoreScroll = true
) {
  window.history.replaceState(null, "", url);
  const main = document.createElement("main");
  main.id = "main-content";
  for (const [name, value] of Object.entries(size)) {
    Object.defineProperty(main, name, { value, configurable: true });
  }
  document.body.appendChild(main);

  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <Root restoreScroll={restoreScroll} />,
        children: [
          {
            element: <AppLayout />,
            children: [
              {
                path: "settings",
                element: <SettingsLayout />,
                children: [
                  { path: "bookings", element: <BookingsPage /> },
                  { path: "team", element: <TeamPage /> },
                ],
              },
            ],
          },
        ],
      },
    ],
    { initialEntries: [url] }
  );

  render(<RouterProvider router={router} />, { container: main });
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  return { main, router };
}

/** Places the sections, scrolls, and lets the hook's frame run. */
async function scrollTo(main: HTMLElement, positions: Record<string, number>) {
  Object.assign(tops, positions);
  await act(async () => {
    main.dispatchEvent(new Event("scroll"));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
}

beforeEach(() => {
  // why: happy-dom has no layout engine; this is how a test puts a section
  // at a given scroll position.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top = tops[this.id] ?? 0;
      return { top, bottom: top + 300 } as DOMRect;
    }
  );
  // why: happy-dom does not scroll; recording the call is how a test sees
  // which section was brought into view.
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element
  ) {
    scrolledTo.push(this.id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  scrolledTo.length = 0;
  for (const id of Object.keys(tops)) delete tops[id];
});

describe("arriving at a section", () => {
  it("scrolls to and focuses the linked section once the page has rendered", async () => {
    await openPage("/settings/bookings#automation");

    const automation = document.getElementById("automation");
    expect(scrolledTo).toContain("automation");
    expect(document.activeElement).toBe(automation);
    // Focusable by script only, not added to the Tab order.
    expect(automation).toHaveAttribute("tabindex", "-1");
  });

  it("does nothing for a hash that names no section", async () => {
    await openPage("/settings/bookings#faq");

    expect(scrolledTo).not.toContain("faq");
    expect(document.activeElement).toBe(document.body);
  });

  it("follows an in-app link to a section, and leaves Back to scroll restoration", async () => {
    const { router } = await openPage("/settings/bookings", undefined, false);

    await act(() => router.navigate("/settings/bookings#automation"));
    expect(scrolledTo).toEqual(["automation"]);

    await act(() => router.navigate("/settings/bookings#notifications"));
    expect(scrolledTo).toEqual(["automation", "notifications"]);

    await act(() => router.navigate(-1));
    expect(scrolledTo).toEqual(["automation", "notifications"]);
  });
});

describe("following the scroll", () => {
  it("puts the section being read in the URL, and drops it above the first one", async () => {
    const { main } = await openPage("/settings/bookings");

    await scrollTo(main, { notifications: -400, automation: 0 });
    expect(window.location.hash).toBe("#automation");

    await scrollTo(main, { notifications: 10, automation: 310 });
    expect(window.location.hash).toBe("#notifications");

    await scrollTo(main, { notifications: 200, automation: 500 });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/settings/bookings");
  });

  it("leaves the hash of a page opened from a link alone until the reader scrolls", async () => {
    Object.assign(tops, { notifications: 200, automation: 500 });
    await openPage("/settings/bookings#automation");

    expect(window.location.hash).toBe("#automation");
  });

  it("keeps a linked section near the bottom while the page cannot scroll further", async () => {
    // At the bottom: scrollTop + clientHeight reaches scrollHeight.
    const { main } = await openPage("/settings/bookings#automation", {
      clientHeight: 800,
      scrollHeight: 2000,
      scrollTop: 1200,
    });

    // notifications has crossed the active line; automation sits lower and
    // can never reach it.
    await scrollTo(main, { notifications: 0, automation: 400 });

    expect(window.location.hash).toBe("#automation");
  });

  it("keeps React Router's history state when it rewrites the hash", async () => {
    const { main } = await openPage("/settings/bookings");
    const routerState = { usr: null, key: "abc123", idx: 3 };
    window.history.replaceState(routerState, "", "/settings/bookings");

    await scrollTo(main, { notifications: 0, automation: 300 });

    expect(window.location.hash).toBe("#notifications");
    expect(window.history.state).toEqual(routerState);
  });

  it("never touches the URL on a page without sections", async () => {
    const { main } = await openPage("/settings/team#members");

    await scrollTo(main, {});

    expect(window.location.hash).toBe("#members");
  });

  it("leaves a hash that names something else on the page", async () => {
    const { main } = await openPage("/settings/bookings#faq");

    await scrollTo(main, { notifications: -400, automation: 0 });

    expect(window.location.hash).toBe("#faq");
  });

  it("takes over again after the skip link points the URL at the scroll area", async () => {
    const { main } = await openPage("/settings/bookings");
    // "Skip to content" links to the scroll area itself.
    window.history.replaceState(null, "", "/settings/bookings#main-content");

    await scrollTo(main, { notifications: -400, automation: 0 });

    expect(window.location.hash).toBe("#automation");
  });
});
