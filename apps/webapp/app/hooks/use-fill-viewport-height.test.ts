/**
 * Tests for {@link resolveFillHeight}.
 *
 * The arithmetic is trivial; what it encodes is not. A full-bleed pane has to
 * end flush with the bottom of its scroll container whatever sits above it, and
 * the arrangements differ: nothing above on a wide viewport, a top bar below
 * `md`, an account banner on top of either. These cases pin that the height
 * follows the measured offset rather than any one arrangement's constant.
 *
 * @see {@link file://./use-fill-viewport-height.ts}
 */
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveFillHeight,
  useFillViewportHeight,
} from "./use-fill-viewport-height";

describe("resolveFillHeight", () => {
  it("fills the whole container when nothing sits above the pane", () => {
    expect(
      resolveFillHeight({ containerHeight: 982, elementOffsetTop: 0 })
    ).toBe(982);
  });

  it("gives back the space taken by chrome above the pane", () => {
    // A mobile top bar of 65px leaves the rest of the screen to the pane.
    expect(
      resolveFillHeight({ containerHeight: 982, elementOffsetTop: 65 })
    ).toBe(917);
  });

  it("accounts for stacked chrome, not just one bar", () => {
    // Top bar plus an account banner — the case a single constant cannot cover.
    expect(
      resolveFillHeight({ containerHeight: 982, elementOffsetTop: 65 + 48 })
    ).toBe(869);
  });

  it("holds the floor when the offset would leave less than the minimum", () => {
    expect(
      resolveFillHeight({
        containerHeight: 500,
        elementOffsetTop: 400,
        minHeight: 400,
      })
    ).toBe(400);
  });

  it("never returns a negative height", () => {
    expect(
      resolveFillHeight({ containerHeight: 300, elementOffsetTop: 900 })
    ).toBe(0);
  });
});

/**
 * Re-measurement tests for {@link useFillViewportHeight}.
 *
 * Chrome above the pane changes height while the viewport does not change size
 * at all — an account banner's line of text wraps as the container narrows, and
 * its inline button swaps to a longer label mid-submit. `useViewportHeight`
 * writes the same `vh` and the same `isMd` throughout, so React bails out and
 * nothing downstream re-runs.
 *
 * The scroll container cannot stand in for that chrome: it is `h-dvh`, so a
 * banner growing taller overflows it rather than resizing it. These tests pin
 * that the chrome itself is watched, and that the pane — whose height this hook
 * writes — never is.
 *
 * happy-dom performs no layout, so the geometry is stubbed and both observers
 * are driven by hand. What is pinned is the wiring, not the browser's
 * arithmetic.
 */
describe("useFillViewportHeight re-measurement", () => {
  /** Captures the resize observer the hook installs, plus what it watches. */
  class FakeResizeObserver {
    static callbacks: (() => void)[] = [];
    static observed: Element[] = [];

    constructor(callback: () => void) {
      FakeResizeObserver.callbacks.push(callback);
    }
    observe(target: Element) {
      FakeResizeObserver.observed.push(target);
    }
    unobserve() {}
    disconnect() {
      FakeResizeObserver.observed = [];
    }
  }

  /** Captures the childList observer, so banner mounts can be simulated. */
  class FakeMutationObserver {
    static callbacks: (() => void)[] = [];

    constructor(callback: () => void) {
      FakeMutationObserver.callbacks.push(callback);
    }
    observe() {}
    disconnect() {}
  }

  /** Viewport-relative top of the pane; moves when chrome above it reflows. */
  let paneTop = 0;
  let container: HTMLElement;
  /**
   * Where the pane is rendered. React's `createRoot` empties whatever element
   * it renders into, so chrome has to sit beside this rather than inside the
   * container directly.
   */
  let mountPoint: HTMLElement;

  function Harness() {
    const { ref, height } = useFillViewportHeight<HTMLDivElement>();
    return createElement("div", {
      ref,
      "data-testid": "pane",
      "data-height": String(height),
    });
  }

  function pane() {
    return screen.getByTestId("pane");
  }

  function paneHeight() {
    return pane().getAttribute("data-height");
  }

  function fireResize() {
    act(() => {
      FakeResizeObserver.callbacks.forEach((cb) => cb());
    });
  }

  function fireChildListChange() {
    act(() => {
      FakeMutationObserver.callbacks.forEach((cb) => cb());
    });
  }

  beforeEach(() => {
    paneTop = 0;
    FakeResizeObserver.callbacks = [];
    FakeResizeObserver.observed = [];
    FakeMutationObserver.callbacks = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("MutationObserver", FakeMutationObserver);

    container = document.createElement("main");
    document.body.appendChild(container);
    Object.defineProperty(container, "clientHeight", {
      value: 982,
      configurable: true,
    });
    mountPoint = document.createElement("div");
    container.appendChild(mountPoint);

    // why: happy-dom lays nothing out, so every rect is 0x0. The container sits
    // at the top of the screen; the pane sits below whatever chrome precedes it.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const top = this.tagName === "MAIN" ? 0 : paneTop;
        return {
          top,
          bottom: 0,
          left: 0,
          right: 0,
          width: 0,
          height: 0,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        } as DOMRect;
      }
    );
  });

  afterEach(() => {
    cleanup();
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Mounts a banner-like element ahead of the pane. */
  function mountChromeAboveThePane() {
    const banner = document.createElement("div");
    container.insertBefore(banner, mountPoint);
    return banner;
  }

  it("watches the scroll container", () => {
    render(createElement(Harness), { container: mountPoint });

    expect(FakeResizeObserver.observed).toContain(container);
  });

  it("watches the chrome above the pane, which the container cannot report", () => {
    const banner = mountChromeAboveThePane();

    render(createElement(Harness), { container: mountPoint });

    expect(FakeResizeObserver.observed).toContain(banner);
  });

  it("never watches the pane whose height it writes", () => {
    mountChromeAboveThePane();
    render(createElement(Harness), { container: mountPoint });

    expect(FakeResizeObserver.observed).not.toContain(pane());
    // Nor anything wrapping it — that would feed the write back in just as
    // well. The container is the deliberate exception: it is `h-dvh`, so the
    // pane's height cannot resize it.
    const chromeWatched = FakeResizeObserver.observed.filter(
      (el) => el !== container
    );
    expect(chromeWatched.some((el) => el.contains(pane()))).toBe(false);
  });

  it("re-measures when watched chrome resizes, with the viewport unchanged", () => {
    render(createElement(Harness), { container: mountPoint });
    expect(paneHeight()).toBe("982");

    // The banner's inline button swaps to a longer label and the text wraps to
    // a second line: the pane moves down 20px while `vh` and `isMd` are
    // untouched.
    paneTop = 20;
    fireResize();

    expect(paneHeight()).toBe("962");
  });

  it("re-measures and re-subscribes when a banner mounts", () => {
    render(createElement(Harness), { container: mountPoint });
    expect(paneHeight()).toBe("982");

    const banner = mountChromeAboveThePane();
    paneTop = 48;
    fireChildListChange();

    expect(paneHeight()).toBe("934");
    expect(FakeResizeObserver.observed).toContain(banner);
  });

  it("leaves the height alone when nothing above the pane moved", () => {
    render(createElement(Harness), { container: mountPoint });
    const before = paneHeight();

    fireResize();

    expect(paneHeight()).toBe(before);
  });
});
