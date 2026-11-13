/**
 * Tests for the new-version prompt: when it shows, that it cannot be
 * dismissed, the unsaved-changes hint on Reload, and which events ask the
 * server for its build.
 *
 * @see {@link file://./new-version-prompt.tsx}
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { getDefaultStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dirtyFormCountAtom } from "~/atoms/unsaved-changes";
import type { BuildVersionState } from "~/utils/build-version-checker";
import { NewVersionPrompt } from "./new-version-prompt";

/** A checker store the tests drive by hand. */
const fakeChecker = vi.hoisted(() => {
  let state: BuildVersionState = { status: "current" };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: vi.fn(() => Promise.resolve("unknown" as const)),
    checkThrottled: vi.fn(() => Promise.resolve(null)),
    /** Moves the store to `next` and notifies subscribers. */
    setState(next: BuildVersionState) {
      state = next;
      listeners.forEach((listener) => listener());
    },
  };
});

// why: the real checker fetches the server's build id over the network
vi.mock("~/utils/build-version-checker", () => ({
  getBuildVersionChecker: () => fakeChecker,
}));

/** Navigation state the mocked `useNavigation` reports. */
const navigation = vi.hoisted(() => ({ state: "idle" }));

// why: the prompt mounts in the layout, outside any router a unit test
// renders; the tests flip the navigation state to drive its checks
vi.mock("react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("react-router");
  return { ...actual, useNavigation: () => navigation };
});

const jotaiStore = getDefaultStore();

/** Puts the store on a newer server build. */
function announce(serverBuildId: string) {
  act(() => fakeChecker.setState({ status: "newer", serverBuildId }));
}

const reloadMock = vi.fn();
const originalLocation = window.location;

beforeEach(() => {
  fakeChecker.setState({ status: "current" });
  fakeChecker.check.mockClear();
  fakeChecker.checkThrottled.mockClear();
  navigation.state = "idle";
  jotaiStore.set(dirtyFormCountAtom, 0);
  reloadMock.mockClear();
  // why: happy-dom cannot reload a page; the tests only need to see the call
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload: reloadMock },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
});

describe("NewVersionPrompt", () => {
  it("renders nothing while the tab runs the current build", () => {
    render(<NewVersionPrompt />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the message and a Reload button once a newer build is live", () => {
    render(<NewVersionPrompt />);
    announce("200");
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("New version available");
    expect(banner).toHaveTextContent(
      "Reload to get the latest version of Shelf."
    );
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("never reloads on its own when it appears", () => {
    render(<NewVersionPrompt />);
    announce("200");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("reloads the page when Reload is clicked", () => {
    render(<NewVersionPrompt />);
    announce("200");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("cannot be dismissed", () => {
    render(<NewVersionPrompt />);
    announce("200");
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Dismiss" })
    ).not.toBeInTheDocument();
  });

  it("asks to save first while a form holds unsaved changes", () => {
    render(<NewVersionPrompt />);
    announce("200");
    const hint = "Save your changes first. Reloading discards them.";
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    act(() => jotaiStore.set(dirtyFormCountAtom, 1));
    expect(screen.getByText(hint)).toBeInTheDocument();
  });
});

describe("NewVersionPrompt build checks", () => {
  it("does not check on mount", () => {
    render(<NewVersionPrompt />);
    expect(fakeChecker.check).not.toHaveBeenCalled();
    expect(fakeChecker.checkThrottled).not.toHaveBeenCalled();
  });

  it("checks (throttled) when the tab becomes visible", () => {
    render(<NewVersionPrompt />);
    let visibility: DocumentVisibilityState = "hidden";
    // why: happy-dom keeps the document visible; the test needs both states
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
      expect(fakeChecker.checkThrottled).not.toHaveBeenCalled();

      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(fakeChecker.checkThrottled).toHaveBeenCalledTimes(1);
    } finally {
      // why: drops the own property so the prototype getter applies again
      Reflect.deleteProperty(document, "visibilityState");
    }
  });

  it("checks (throttled) when a navigation completes", () => {
    const { rerender } = render(<NewVersionPrompt />);
    navigation.state = "loading";
    rerender(<NewVersionPrompt />);
    expect(fakeChecker.checkThrottled).not.toHaveBeenCalled();

    navigation.state = "idle";
    rerender(<NewVersionPrompt />);
    expect(fakeChecker.checkThrottled).toHaveBeenCalledTimes(1);
  });

  it("checks right away when a lazy chunk fails to preload", () => {
    render(<NewVersionPrompt />);
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(fakeChecker.check).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<NewVersionPrompt />);
    unmount();
    window.dispatchEvent(new Event("vite:preloadError"));
    expect(fakeChecker.check).not.toHaveBeenCalled();
  });
});
