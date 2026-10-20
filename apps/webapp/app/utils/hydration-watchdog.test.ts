/**
 * Tests for the hydration watchdog: the inline script that turns a bundle
 * which never loads into a reload (once) or a recovery screen, and the
 * report it leaves for the next page that does hydrate.
 *
 * The script runs against the real happy-dom document and storage, with a
 * stand-in `window` whose `location` records reloads instead of performing
 * them.
 *
 * @see {@link file://./hydration-watchdog.ts}
 */
import * as Sentry from "@sentry/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNSUPPORTED_BROWSER_ATTRIBUTE } from "./browser-support";
import type { HydrationFailureReport } from "./hydration-watchdog";
import {
  HYDRATION_FAILED_ATTRIBUTE,
  HYDRATION_FAILED_SCREEN_ID,
  HYDRATION_FAILURE_STORAGE_KEY,
  HYDRATION_GATE_STYLES,
  HYDRATION_RELOAD_ATTRIBUTE,
  HYDRATION_RELOAD_WINDOW_MS,
  HYDRATION_TIMEOUT_MS,
  HYDRATION_WATCHDOG_SCRIPT,
  markHydrated,
} from "./hydration-watchdog";

// why: Sentry is a network side effect; the test asserts what would be sent.
vi.mock("@sentry/react-router", () => ({ captureMessage: vi.fn() }));

/** The origin the page is served from, as the script sees it. */
const ORIGIN = "https://app.shelf.nu";

/** A file of the app's own bundle. */
const OWN_CHUNK = `${ORIGIN}/file-assets/abc/chunk-X1.js`;

/** The Cloudflare analytics beacon, which content blockers commonly stop. */
const THIRD_PARTY_SCRIPT =
  "https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d873";

type FakeWindow = {
  location: {
    origin: string;
    pathname: string;
    reload: ReturnType<typeof vi.fn>;
  };
  __shelfHydrationWatchdog?: { done: () => void };
};

let fakeWindow: FakeWindow;

/** Runs the inline script the way the document `<head>` would. */
function runWatchdog() {
  fakeWindow = {
    location: { origin: ORIGIN, pathname: "/assets", reload: vi.fn() },
  };
  // why: `location.reload` cannot be observed on the real window, so the
  // script gets a window whose location records it. Everything else is the
  // real happy-dom implementation.
  const scriptWindow = new Proxy(fakeWindow, {
    get(target, key: string) {
      if (key in target) {
        return target[key as keyof FakeWindow];
      }
      const value = Reflect.get(window, key);
      return typeof value === "function" ? value.bind(window) : value;
    },
  });
  new Function("window", "document", HYDRATION_WATCHDOG_SCRIPT)(
    scriptWindow,
    document
  );
}

/** Appends an element and fires the load error a failed download produces. */
function failToLoad(element: HTMLElement) {
  document.head.appendChild(element);
  element.dispatchEvent(new Event("error"));
}

/**
 * An inline module script, like React Router's bootstrap. Its static imports
 * failing fires the error on this element. No `src`, so happy-dom does not try
 * to fetch anything.
 */
function moduleScript() {
  const script = document.createElement("script");
  script.type = "module";
  return script;
}

/**
 * A module script with a `src`. The property is defined on the instance rather
 * than set as an attribute, so happy-dom does not try to fetch it.
 */
function externalModuleScript(src: string) {
  const script = moduleScript();
  Object.defineProperty(script, "src", { value: src });
  return script;
}

function modulePreload(href: string) {
  const link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = href;
  return link;
}

function storedReport(): HydrationFailureReport | null {
  return JSON.parse(
    sessionStorage.getItem(HYDRATION_FAILURE_STORAGE_KEY) ?? "null"
  );
}

const isShowingScreen = () =>
  document.documentElement.hasAttribute(HYDRATION_FAILED_ATTRIBUTE);

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.documentElement.removeAttribute(HYDRATION_FAILED_ATTRIBUTE);
  document.documentElement.removeAttribute(UNSUPPORTED_BROWSER_ATTRIBUTE);
  vi.mocked(Sentry.captureMessage).mockClear();
});

afterEach(() => {
  // Stand the script down so its listeners do not leak into the next test.
  fakeWindow.__shelfHydrationWatchdog?.done();
  vi.useRealTimers();
});

describe("HYDRATION_WATCHDOG_SCRIPT: a chunk fails to load", () => {
  it("reloads the page once and records why", () => {
    runWatchdog();
    failToLoad(modulePreload(OWN_CHUNK));

    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
    expect(isShowingScreen()).toBe(false);
    expect(storedReport()).toMatchObject({
      reason: "load-error",
      source: expect.stringContaining("/file-assets/abc/chunk-X1.js"),
      path: "/assets",
      failures: 1,
      reloadedAt: expect.any(Number),
    });
  });

  it("shows the recovery screen instead of reloading again when the reload fails too", () => {
    runWatchdog();
    failToLoad(moduleScript());
    fakeWindow.__shelfHydrationWatchdog?.done();

    // The reloaded page fails the same way.
    runWatchdog();
    failToLoad(moduleScript());

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
    expect(isShowingScreen()).toBe(true);
    expect(storedReport()).toMatchObject({ failures: 2 });
  });

  it("reloads again once the last automatic reload is old enough", () => {
    runWatchdog();
    failToLoad(moduleScript());
    fakeWindow.__shelfHydrationWatchdog?.done();

    vi.advanceTimersByTime(HYDRATION_RELOAD_WINDOW_MS + 1);
    runWatchdog();
    failToLoad(moduleScript());

    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
  });

  it("treats a failed inline module script as a failed load", () => {
    runWatchdog();
    failToLoad(moduleScript());

    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
    expect(storedReport()).toMatchObject({ source: "inline module script" });
  });

  it("treats a rejected dynamic import of the bundle as a failed load", () => {
    runWatchdog();
    const event = Object.assign(new Event("unhandledrejection"), {
      reason: new TypeError(
        "Failed to fetch dynamically imported module: /file-assets/entry.client-X1.js"
      ),
    });
    window.dispatchEvent(event);

    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
  });

  it("ignores files that do not stop hydration, like a blocked analytics script", () => {
    runWatchdog();
    // A classic (non-module) script, like the Clarity or Cloudflare tags.
    failToLoad(document.createElement("script"));
    failToLoad(document.createElement("img"));

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
    expect(isShowingScreen()).toBe(false);
  });

  it("does nothing in a browser the support check already turned away", () => {
    document.documentElement.setAttribute(UNSUPPORTED_BROWSER_ATTRIBUTE, "");
    runWatchdog();
    failToLoad(moduleScript());
    vi.advanceTimersByTime(HYDRATION_TIMEOUT_MS);

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
    expect(isShowingScreen()).toBe(false);
  });
});

describe("HYDRATION_WATCHDOG_SCRIPT: files from another origin", () => {
  it("counts a module script of our own", () => {
    runWatchdog();
    failToLoad(externalModuleScript(OWN_CHUNK));

    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
  });

  it("ignores a blocked third-party module script", () => {
    runWatchdog();
    failToLoad(externalModuleScript(THIRD_PARTY_SCRIPT));

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
    expect(isShowingScreen()).toBe(false);
    expect(storedReport()).toBeNull();
  });

  it("ignores a blocked third-party modulepreload", () => {
    runWatchdog();
    failToLoad(modulePreload(THIRD_PARTY_SCRIPT));

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
  });

  it("ignores a rejected dynamic import of a third-party file", () => {
    runWatchdog();
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new TypeError(
          `Failed to fetch dynamically imported module: ${THIRD_PARTY_SCRIPT}`
        ),
      })
    );

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
  });

  it("counts Safari's import failure, which names no URL", () => {
    runWatchdog();
    window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new TypeError("Importing a module script failed."),
      })
    );

    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
  });
});

describe("HYDRATION_WATCHDOG_SCRIPT: the reload loop guard", () => {
  it("holds after the reloaded page hydrated and sent its report", () => {
    runWatchdog();
    failToLoad(moduleScript());
    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);

    // The reloaded page hydrates, which consumes and sends the report.
    runWatchdog();
    markHydrated();
    fakeWindow.__shelfHydrationWatchdog?.done();
    expect(storedReport()).toBeNull();

    // The next load fails again within the window: no second reload.
    runWatchdog();
    failToLoad(moduleScript());

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
    expect(isShowingScreen()).toBe(true);
  });
});

describe("HYDRATION_WATCHDOG_SCRIPT: the page is slow to hydrate", () => {
  it("shows the recovery screen at the timeout without reloading", () => {
    runWatchdog();
    vi.advanceTimersByTime(HYDRATION_TIMEOUT_MS - 1);
    expect(isShowingScreen()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(isShowingScreen()).toBe(true);
    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
    expect(storedReport()).toMatchObject({
      reason: "timeout",
      reloadedAt: null,
    });
  });

  it("removes the screen again if hydration completes late", () => {
    runWatchdog();
    vi.advanceTimersByTime(HYDRATION_TIMEOUT_MS);
    fakeWindow.__shelfHydrationWatchdog?.done();

    expect(isShowingScreen()).toBe(false);
  });
});

describe("HYDRATION_WATCHDOG_SCRIPT: after hydration", () => {
  it("stops watching, so later chunk failures stay with the router", () => {
    runWatchdog();
    fakeWindow.__shelfHydrationWatchdog?.done();

    failToLoad(moduleScript());
    vi.advanceTimersByTime(HYDRATION_TIMEOUT_MS);

    expect(fakeWindow.location.reload).not.toHaveBeenCalled();
    expect(isShowingScreen()).toBe(false);
    expect(storedReport()).toBeNull();
  });
});

describe("HYDRATION_WATCHDOG_SCRIPT: the reload button", () => {
  it("reloads the page without React", () => {
    runWatchdog();
    document.body.innerHTML = `<button ${HYDRATION_RELOAD_ATTRIBUTE}=""><span>Reload</span></button>`;
    document.querySelector("span")?.click();

    expect(fakeWindow.location.reload).toHaveBeenCalledTimes(1);
  });

  it("stays parseable by pre-ES2015 engines (no arrow functions, let/const, template literals)", () => {
    expect(HYDRATION_WATCHDOG_SCRIPT).not.toMatch(/=>|\blet\b|\bconst\b|`/);
  });
});

describe("HYDRATION_GATE_STYLES", () => {
  it("shows only the recovery screen while the document is flagged", () => {
    expect(HYDRATION_GATE_STYLES).toContain(
      `#${HYDRATION_FAILED_SCREEN_ID}{display:none}`
    );
    expect(HYDRATION_GATE_STYLES).toContain(
      `html[${HYDRATION_FAILED_ATTRIBUTE}] #${HYDRATION_FAILED_SCREEN_ID}{display:block}`
    );
    expect(HYDRATION_GATE_STYLES).toContain(
      `html[${HYDRATION_FAILED_ATTRIBUTE}] body>:not(#${HYDRATION_FAILED_SCREEN_ID}){display:none}`
    );
  });
});

describe("markHydrated", () => {
  it("reports a failed earlier load to Sentry once, then forgets it", () => {
    runWatchdog();
    failToLoad(moduleScript());

    markHydrated();
    markHydrated();

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "App bundle failed to load before hydration",
      expect.objectContaining({
        level: "warning",
        fingerprint: ["hydration-failure", "load-error"],
        tags: {
          hydration_failure: "load-error",
          hydration_auto_reloaded: "yes",
        },
      })
    );
    expect(storedReport()).toBeNull();
  });

  it("sends nothing after a clean load", () => {
    runWatchdog();
    markHydrated();

    expect(Sentry.captureMessage).not.toHaveBeenCalled();
  });
});
