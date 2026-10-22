/**
 * Hydration watchdog.
 *
 * The authenticated layout renders "Activating workspace..." on the server and
 * replaces it only once React hydrates (`_layout.tsx`). Hydration needs every
 * file of the client module graph: one chunk that fails to download (a flaky
 * network, a corporate proxy, a file from another deploy) stops the whole
 * graph, and nothing in the bundle runs to say so. Without this watchdog the
 * user is left looking at that spinner indefinitely.
 *
 * {@link HYDRATION_WATCHDOG_SCRIPT} runs as a classic inline script in the
 * document `<head>`, before any module script, and fails the page in two ways:
 *
 * - **load-error**: a module script, a `modulepreload` link or a dynamic
 *   `import()` of the bundle failed. The page reloads itself once; if the
 *   reload fails as well, the recovery screen is shown.
 * - **timeout**: nothing hydrated within {@link HYDRATION_TIMEOUT_MS}. The
 *   recovery screen is shown, without reloading, since a slow network would
 *   only start over. If hydration completes later the screen goes away again.
 *
 * Failing sets {@link HYDRATION_FAILED_ATTRIBUTE} on `<html>`, which
 * {@link HYDRATION_GATE_STYLES} turns into the recovery screen rendered by
 * `app/root.tsx`. Its reload button works through a delegated listener in the
 * same script, because React event handlers never attach on a page that did
 * not hydrate.
 *
 * Sentry cannot see these failures: it is initialised by the bundle that did
 * not load. The script therefore keeps a report in `sessionStorage`, and the
 * next page that does hydrate sends it ({@link markHydrated}).
 *
 * @see {@link file://./browser-support.ts} - the same inline gate pattern for unsupported browsers
 * @see {@link file://./../root.tsx} - renders the screen and calls markHydrated
 * @see {@link file://./../../server/missing-build-asset.ts} - makes a missing chunk fail as a 404
 */
import * as Sentry from "@sentry/react-router";
import { UNSUPPORTED_BROWSER_ATTRIBUTE } from "./browser-support";

/** Set on `<html>` while the recovery screen is shown. */
export const HYDRATION_FAILED_ATTRIBUTE = "data-hydration-failed";

/** `id` of the recovery screen rendered by `app/root.tsx`. */
export const HYDRATION_FAILED_SCREEN_ID = "hydration-failed";

/** Marks the button on the recovery screen that reloads the page. */
export const HYDRATION_RELOAD_ATTRIBUTE = "data-hydration-reload";

/** `sessionStorage` key holding the pending failure report. */
export const HYDRATION_FAILURE_STORAGE_KEY = "shelf:hydration-failure";

/**
 * `sessionStorage` key holding the time of the last automatic reload. Kept
 * apart from the report on purpose: sending the report clears it, and the loop
 * guard must survive that, or every reload that hydrates would re-arm the next.
 */
export const HYDRATION_RELOADED_AT_STORAGE_KEY = "shelf:hydration-reloaded-at";

/** How long a page may take to hydrate before the recovery screen is shown. */
export const HYDRATION_TIMEOUT_MS = 20_000;

/**
 * A load error within this window of the last automatic reload shows the
 * screen instead of reloading again, so a chunk that keeps failing cannot put
 * the tab in a reload loop.
 */
export const HYDRATION_RELOAD_WINDOW_MS = 60_000;

/** Global the inline script exposes so the bundle can stand it down. */
const WATCHDOG_GLOBAL = "__shelfHydrationWatchdog";

declare global {
  interface Window {
    [WATCHDOG_GLOBAL]?: { done: () => void };
  }
}

/** Why a page failed to hydrate. */
export type HydrationFailureReason = "load-error" | "timeout";

/** What the inline script records about a failed page load. */
export type HydrationFailureReport = {
  reason: HydrationFailureReason;
  /** URL of the file that failed, or the error message of a failed `import()`. */
  source: string | null;
  /** Pathname of the page that failed. */
  path: string;
  /** Epoch ms of the failure. */
  at: number;
  /**
   * Epoch ms of the automatic reload in this unbroken chain of failed loads,
   * whether this failure triggered it or an earlier one did. A successful
   * hydration ends the chain.
   */
  reloadedAt: number | null;
  /** Consecutive failed loads in this tab since the last successful one. */
  failures: number;
};

/**
 * Inline stylesheet for the recovery screen: hidden by default, shown (and
 * the rest of the body hidden) while the document carries
 * {@link HYDRATION_FAILED_ATTRIBUTE}. Inlined in `<head>` so it applies even
 * when the linked stylesheets are what failed.
 */
export const HYDRATION_GATE_STYLES = [
  `#${HYDRATION_FAILED_SCREEN_ID}{display:none}`,
  `html[${HYDRATION_FAILED_ATTRIBUTE}] #${HYDRATION_FAILED_SCREEN_ID}{display:block}`,
  `html[${HYDRATION_FAILED_ATTRIBUTE}] body>:not(#${HYDRATION_FAILED_SCREEN_ID}){display:none}`,
].join("");

/**
 * The watchdog itself. Plain ES5, like the browser-support check, so it parses
 * everywhere and never depends on the bundle it is watching.
 *
 * Only failures of the bundle count: an inline `<script type="module">` (React
 * Router's bootstrap), a module script or `<link rel="modulepreload">` from
 * this origin, and rejected dynamic imports of a file on this origin. Anything
 * from another origin, such as an analytics beacon that a content blocker
 * stops, cannot block hydration and never counts, whatever its element type.
 * Once the page hydrates the listeners are removed, so later lazy-route
 * chunk failures stay with React Router.
 */
export const HYDRATION_WATCHDOG_SCRIPT = `(function () {
  var root = document.documentElement;
  var settled = false;
  var failed = false;
  var timer;
  var KEY = "${HYDRATION_FAILURE_STORAGE_KEY}";
  var RELOADED_AT_KEY = "${HYDRATION_RELOADED_AT_STORAGE_KEY}";
  var ORIGIN = window.location.origin;

  function readReport() {
    try {
      return JSON.parse(window.sessionStorage.getItem(KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function writeReport(report) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(report));
      return true;
    } catch (e) {
      return false;
    }
  }

  function readReloadedAt() {
    try {
      return Number(window.sessionStorage.getItem(RELOADED_AT_KEY)) || null;
    } catch (e) {
      return null;
    }
  }

  function writeReloadedAt(time) {
    try {
      window.sessionStorage.setItem(RELOADED_AT_KEY, String(time));
      return true;
    } catch (e) {
      return false;
    }
  }

  function isOwnUrl(url) {
    return typeof url === "string" && url.indexOf(ORIGIN + "/") === 0;
  }

  function fail(reason, source) {
    if (settled || failed || root.hasAttribute("${UNSUPPORTED_BROWSER_ATTRIBUTE}")) {
      return;
    }
    failed = true;
    var previous = readReport();
    var now = Date.now();
    var lastReload = readReloadedAt();
    var report = {
      reason: reason,
      source: source || null,
      path: window.location.pathname,
      at: now,
      // The guard key outlives a successful hydration; the report does not.
      // Report only a reload from this chain of failures.
      reloadedAt: (previous && previous.reloadedAt) || null,
      failures: ((previous && previous.failures) || 0) + 1
    };
    var reloadedRecently = lastReload !== null && now - lastReload < ${HYDRATION_RELOAD_WINDOW_MS};
    if (reason === "load-error" && !reloadedRecently) {
      report.reloadedAt = now;
      // Without storage there is no loop guard, so only reload when it saved.
      if (writeReloadedAt(now) && writeReport(report)) {
        stop();
        window.location.reload();
        return;
      }
    }
    writeReport(report);
    root.setAttribute("${HYDRATION_FAILED_ATTRIBUTE}", "");
  }

  function onError(event) {
    var target = event.target;
    if (!target || !target.tagName) {
      return;
    }
    if (target.tagName === "SCRIPT" && target.type === "module") {
      if (!target.src) {
        fail("load-error", "inline module script");
      } else if (isOwnUrl(target.src)) {
        fail("load-error", target.src);
      }
    } else if (target.tagName === "LINK" && target.rel === "modulepreload" && isOwnUrl(target.href)) {
      fail("load-error", target.href);
    }
  }

  function onRejection(event) {
    var reason = event.reason;
    var message = reason && reason.message ? String(reason.message) : String(reason);
    // Safari's message names no URL.
    if (/importing a module script failed/i.test(message)) {
      fail("load-error", message);
      return;
    }
    // Chrome and Firefox name the module, in any scheme (data:, blob:,
    // chrome-extension:). Only a file of ours counts; with no name, accept it.
    var named = message.match(/dynamically imported module:?\\s*(\\S*)/i);
    if (named && (!named[1] || isOwnUrl(named[1]))) {
      fail("load-error", message);
    }
  }

  function onClick(event) {
    var target = event.target;
    if (target && target.closest && target.closest("[${HYDRATION_RELOAD_ATTRIBUTE}]")) {
      window.location.reload();
    }
  }

  function stop() {
    settled = true;
    window.clearTimeout(timer);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("click", onClick);
  }

  // Capture phase: resource load errors do not bubble.
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("click", onClick);
  timer = window.setTimeout(function () {
    fail("timeout", null);
  }, ${HYDRATION_TIMEOUT_MS});

  window.${WATCHDOG_GLOBAL} = {
    done: function () {
      stop();
      root.removeAttribute("${HYDRATION_FAILED_ATTRIBUTE}");
    }
  };
})();`;

/**
 * Reads and clears the report a failed load left behind.
 *
 * @returns The pending report, or `null` when there is none or storage is unavailable
 */
export function consumeHydrationFailureReport(): HydrationFailureReport | null {
  try {
    const raw = window.sessionStorage.getItem(HYDRATION_FAILURE_STORAGE_KEY);
    window.sessionStorage.removeItem(HYDRATION_FAILURE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as HydrationFailureReport) : null;
  } catch {
    return null;
  }
}

/**
 * Stands the watchdog down and reports any earlier failed load to Sentry.
 * Call once, after hydration commits.
 *
 * A report present here means the page did hydrate in the end: after the
 * automatic reload, after a manual one, or late, past the timeout.
 */
export function markHydrated(): void {
  window[WATCHDOG_GLOBAL]?.done();

  const report = consumeHydrationFailureReport();
  if (!report) {
    return;
  }

  Sentry.captureMessage("App bundle failed to load before hydration", {
    level: "warning",
    // One issue per reason, not one per failing chunk URL.
    fingerprint: ["hydration-failure", report.reason],
    tags: {
      hydration_failure: report.reason,
      hydration_auto_reloaded: report.reloadedAt !== null ? "yes" : "no",
    },
    extra: {
      ...report,
      // Time from navigation start to hydration on this successful load.
      hydratedAfterMs: Math.round(performance.now()),
    },
  });
}
