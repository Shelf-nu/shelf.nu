/**
 * Tests for {@link observeChromeAbove}.
 *
 * An element below the layout chrome moves when that chrome changes height,
 * without resizing itself and without the window resizing. These pin that the
 * chrome is what gets watched, that a banner mounting is heard, and that the
 * element's own branch is never observed.
 *
 * @see {@link file://./observe-chrome-above.ts}
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { observeChromeAbove } from "./observe-chrome-above";

// why: happy-dom does no layout, so a real ResizeObserver never fires; the
// fake records what is observed and lets a test report a resize.
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  constructor(private callback: () => void) {
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element) {
    this.observed.add(target);
  }
  disconnect() {
    this.observed.clear();
  }
  fire() {
    this.callback();
  }
}

// why: lets a test report a child-list change synchronously.
class FakeMutationObserver {
  static instances: FakeMutationObserver[] = [];
  connected = false;
  constructor(private callback: () => void) {
    FakeMutationObserver.instances.push(this);
  }
  observe() {
    this.connected = true;
  }
  disconnect() {
    this.connected = false;
  }
  fire() {
    this.callback();
  }
}

/** `<main>` holding a banner, the element's branch, and chrome below it. */
function mountLayout() {
  document.body.innerHTML = `
    <main>
      <div id="banner"></div>
      <section id="branch"><div id="panel"></div></section>
      <footer id="below"></footer>
    </main>`;
  const byId = (id: string) => document.getElementById(id)!;
  return {
    main: document.querySelector("main")!,
    banner: byId("banner"),
    branch: byId("branch"),
    panel: byId("panel"),
    below: byId("below"),
  };
}

describe("observeChromeAbove", () => {
  beforeEach(() => {
    FakeResizeObserver.instances = [];
    FakeMutationObserver.instances = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.stubGlobal("MutationObserver", FakeMutationObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("watches the container and the chrome above the element, nothing else", () => {
    const { main, banner, branch, panel, below } = mountLayout();
    observeChromeAbove(panel, vi.fn());

    const { observed } = FakeResizeObserver.instances[0];
    expect(observed.has(main)).toBe(true);
    expect(observed.has(banner)).toBe(true);
    expect(observed.has(branch)).toBe(false);
    expect(observed.has(panel)).toBe(false);
    expect(observed.has(below)).toBe(false);
  });

  it("reports a resize of the chrome", () => {
    const { panel } = mountLayout();
    const onChange = vi.fn();
    observeChromeAbove(panel, onChange);

    FakeResizeObserver.instances[0].fire();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("reports a banner mounting and starts watching it", () => {
    const { main, branch, panel } = mountLayout();
    const onChange = vi.fn();
    observeChromeAbove(panel, onChange);

    const newBanner = document.createElement("div");
    main.insertBefore(newBanner, branch);
    FakeMutationObserver.instances[0].fire();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(FakeResizeObserver.instances[0].observed.has(newBanner)).toBe(true);
  });

  it("disconnects everything on cleanup", () => {
    const { panel } = mountLayout();
    const stop = observeChromeAbove(panel, vi.fn());
    stop();

    expect(FakeResizeObserver.instances[0].observed.size).toBe(0);
    expect(FakeMutationObserver.instances[0].connected).toBe(false);
  });
});
