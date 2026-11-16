/**
 * Tests for useSectionHashSync: the URL hash follows the section being read.
 *
 * happy-dom does no layout, so each section's position is set by hand
 * through `getBoundingClientRect`, the one layout read the hook makes.
 *
 * @see {@link file://./use-section-hash-sync.ts}
 */
import type { ReactElement } from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Card } from "~/components/shared/card";
import { useSectionHashSync } from "./use-section-hash-sync";

/** Top of each section relative to the scroll area, set per test. */
const tops: Record<string, number> = {};

function Page({ withSections = true }: { withSections?: boolean }) {
  useSectionHashSync();
  return withSections ? (
    <>
      <Card id="notifications">Notifications</Card>
      <Card id="automation">Automation</Card>
    </>
  ) : (
    <p>Team list</p>
  );
}

/** Renders the page inside the app's scroll area, as the layout does. */
function renderInScrollArea(ui: ReactElement) {
  const main = document.createElement("main");
  main.id = "main-content";
  // A tall page in a normal window, so the reader is never at the bottom.
  Object.defineProperty(main, "clientHeight", { value: 800 });
  Object.defineProperty(main, "scrollHeight", { value: 5000 });
  document.body.appendChild(main);
  const result = render(ui, { container: main });
  return { main, ...result };
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
  window.history.replaceState(null, "", "/settings/bookings");
  // why: happy-dom has no layout engine; this is how a test puts a section
  // at a given scroll position.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const top = tops[this.id] ?? 0;
      return { top, bottom: top + 300 } as DOMRect;
    }
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  for (const id of Object.keys(tops)) delete tops[id];
});

describe("useSectionHashSync", () => {
  it("puts the section being read in the URL, and drops it above the first one", async () => {
    const { main } = renderInScrollArea(<Page />);

    await scrollTo(main, { notifications: -400, automation: 0 });
    expect(window.location.hash).toBe("#automation");

    await scrollTo(main, { notifications: 10, automation: 310 });
    expect(window.location.hash).toBe("#notifications");

    await scrollTo(main, { notifications: 200, automation: 500 });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/settings/bookings");
  });

  it("leaves the hash of a page opened from a link alone until the reader scrolls", async () => {
    window.history.replaceState(null, "", "/settings/bookings#automation");
    Object.assign(tops, { notifications: 200, automation: 500 });

    renderInScrollArea(<Page />);
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(window.location.hash).toBe("#automation");
  });

  it("keeps React Router's history state when it rewrites the hash", async () => {
    const routerState = { usr: null, key: "abc123", idx: 3 };
    window.history.replaceState(routerState, "", "/settings/bookings");
    const { main } = renderInScrollArea(<Page />);

    await scrollTo(main, { notifications: 0, automation: 300 });

    expect(window.location.hash).toBe("#notifications");
    expect(window.history.state).toEqual(routerState);
  });

  it("never touches the URL on a page without sections", async () => {
    window.history.replaceState(null, "", "/settings/team#members");
    const { main } = renderInScrollArea(<Page withSections={false} />);

    await scrollTo(main, {});

    expect(window.location.hash).toBe("#members");
  });

  it("leaves a hash that names something other than a section", async () => {
    window.history.replaceState(null, "", "/settings/bookings#not-a-card");
    const { main } = renderInScrollArea(<Page />);

    await scrollTo(main, { notifications: -400, automation: 0 });

    expect(window.location.hash).toBe("#not-a-card");
  });
});
