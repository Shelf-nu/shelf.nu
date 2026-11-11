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
 * - **timeout**: nothing hydrated within {@link HYDRATION_TIMEOUT_MS} of the
 *   tab being visible. The recovery screen is shown, without reloading, since
 *   a slow network would only start over. If hydration completes later the
 *   screen goes away again. Time spent hidden (a background tab, a restored
 *   session, a prerender) does not count: browsers deprioritise such tabs, and
 *   nobody is waiting on them.
 *
 * Failing sets {@link HYDRATION_FAILED_ATTRIBUTE} on `<html>`, which
 * {@link HYDRATION_GATE_STYLES} turns into the recovery screen rendered by
 * `app/root.tsx`. Its reload button works through a delegated listener in the
 * same script, because React event handlers never attach on a page that did
 * not hydrate.
 *
 * Sentry cannot see these failures: it is initialised by the bundle that did
 * not load. The script therefore keeps a report in `sessionStorage`, and the
 * next page that does hydrate sends it ({@link markHydrated}). A load whose
 * automatic reload worked at once is sent as an info log, since the user only
 * saw a reload; anything that showed the recovery screen is a warning issue,
 * except a timeout that fired before its clock ran out, which is an info issue
 * of its own ({@link timedOutEarly}).
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

/**
 * How long a page may take to hydrate, counting only time the tab is visible,
 * before the recovery screen is shown.
 */
export const HYDRATION_TIMEOUT_MS = 20_000;

/**
 * A load error within this window of the last automatic reload shows the
 * screen instead of reloading again, so a chunk that keeps failing cannot put
 * the tab in a reload loop.
 */
export const HYDRATION_RELOAD_WINDOW_MS = 60_000;

/**
 * How many resource timing entries the page keeps. The browser default of 250
 * is smaller than the module graph of the biggest pages (about 290 files on
 * `/assets`), and a dropped entry would read as a file that never finished.
 */
export const RESOURCE_TIMING_BUFFER_SIZE = 1_000;

/** At most this many unfinished files are named in a report. */
export const MAX_MISSING_BUNDLE_FILES = 10;

/**
 * Wall-clock time running ahead of the page's monotonic clock by more than
 * this means the device slept, or its clock was changed, while the page loaded.
 * The timings in such a report do not describe a user waiting.
 */
export const HYDRATION_CLOCK_GAP_MS = 5_000;

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
  // The fields below describe the page when it failed, to tell a slow network
  // from a slow device or a tab nobody was looking at. Optional: a report
  // stored by an older script has none of them.
  /** The tab was hidden at some point before the failure. */
  hidden?: boolean;
  /** Milliseconds from navigation start to the failure. */
  failedAfterMs?: number | null;
  /** Script files from this origin that had finished downloading. */
  bundleFilesLoaded?: number;
  /**
   * Script files from this origin the page asked for (module scripts and
   * `modulepreload` links). `null` when the document could not be read.
   */
  bundleFilesExpected?: number | null;
  /**
   * Paths of requested files with no finished download yet, up to
   * {@link MAX_MISSING_BUNDLE_FILES}. A download that stalls raises no error,
   * so this is the only trace it leaves. `null` when the requested files or
   * the finished downloads could not be read in full: the list would be wrong.
   */
  missingBundleFiles?: string[] | null;
  /** Milliseconds from navigation start until the last of them finished. */
  lastBundleFileMs?: number | null;
  /**
   * Wall-clock milliseconds from navigation start to the failure. Compared
   * with `failedAfterMs` by {@link hasClockGap}.
   */
  wallClockMs?: number | null;
  /** `navigator.connection.effectiveType`, where the browser exposes it. */
  connection?: string | null;
  /** The browser is driven by automation (`navigator.webdriver`). */
  automated?: boolean;
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
  // The timeout clock: it runs only while the tab is visible, and measures on
  // the monotonic clock so a wall-clock change cannot shorten or stretch it.
  var perf = window.performance;
  var remaining = ${HYDRATION_TIMEOUT_MS};
  var clockStartedAt = null;
  var wasHidden = document.visibilityState === "hidden";
  var KEY = "${HYDRATION_FAILURE_STORAGE_KEY}";
  var RELOADED_AT_KEY = "${HYDRATION_RELOADED_AT_STORAGE_KEY}";
  var ORIGIN = window.location.origin;

  // Set once the browser starts dropping timing entries.
  var timingBufferFull = false;

  try {
    if (perf && perf.setResourceTimingBufferSize) {
      perf.setResourceTimingBufferSize(${RESOURCE_TIMING_BUFFER_SIZE});
    }
    if (perf && perf.addEventListener) {
      perf.addEventListener("resourcetimingbufferfull", function () {
        timingBufferFull = true;
      });
    }
  } catch (e) {}

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

  function elapsedNow() {
    return perf && perf.now ? perf.now() : Date.now();
  }

  function withoutQuery(url) {
    return String(url).split("?")[0];
  }

  function diagnostics() {
    var files = 0;
    var last = null;
    var finished = {};
    var timingReadable = true;
    try {
      var entries = perf.getEntriesByType("resource");
      for (var i = 0; i < entries.length; i++) {
        var name = withoutQuery(entries[i].name);
        if (isOwnUrl(name) && name.slice(-3) === ".js") {
          files++;
          finished[name] = true;
          if (last === null || entries[i].responseEnd > last) {
            last = entries[i].responseEnd;
          }
        }
      }
    } catch (e) {
      files = 0;
      timingReadable = false;
    }
    // A stalled download raises no error and leaves no timing entry, so the
    // files the page asked for are compared with the ones that finished.
    var expected = 0;
    var missing = [];
    try {
      var requested = {};
      var nodes = document.querySelectorAll('link[rel="modulepreload"], script[type="module"]');
      for (var j = 0; j < nodes.length; j++) {
        var url = withoutQuery(nodes[j].tagName === "LINK" ? nodes[j].href : nodes[j].src);
        if (!isOwnUrl(url) || requested[url]) {
          continue;
        }
        requested[url] = true;
        expected++;
        if (!finished[url] && missing.length < ${MAX_MISSING_BUNDLE_FILES}) {
          missing.push(url.slice(ORIGIN.length));
        }
      }
    } catch (e) {
      expected = null;
      missing = null;
    }
    // Without every finished download to compare with, loaded files would be
    // listed as missing.
    if (!timingReadable || timingBufferFull) {
      missing = null;
    }
    var connection = navigator.connection && navigator.connection.effectiveType;
    return {
      hidden: wasHidden,
      failedAfterMs: perf && perf.now ? Math.round(perf.now()) : null,
      bundleFilesLoaded: files,
      bundleFilesExpected: expected,
      missingBundleFiles: missing,
      lastBundleFileMs: last === null ? null : Math.round(last),
      // Monotonic time stops while the device sleeps; wall-clock time does not.
      wallClockMs: perf && perf.timeOrigin ? Math.round(Date.now() - perf.timeOrigin) : null,
      connection: connection || null,
      automated: navigator.webdriver === true
    };
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
    var details = diagnostics();
    for (var key in details) {
      report[key] = details[key];
    }
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

  function startClock() {
    if (settled || failed || clockStartedAt !== null) {
      return;
    }
    clockStartedAt = elapsedNow();
    timer = window.setTimeout(function () {
      fail("timeout", null);
    }, remaining);
  }

  function pauseClock() {
    if (clockStartedAt === null) {
      return;
    }
    window.clearTimeout(timer);
    remaining -= elapsedNow() - clockStartedAt;
    clockStartedAt = null;
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      wasHidden = true;
      pauseClock();
    } else {
      startClock();
    }
  }

  function stop() {
    settled = true;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("error", onError, true);
    window.removeEventListener("unhandledrejection", onRejection);
    document.removeEventListener("click", onClick);
  }

  // Capture phase: resource load errors do not bubble.
  window.addEventListener("error", onError, true);
  window.addEventListener("unhandledrejection", onRejection);
  document.addEventListener("click", onClick);
  document.addEventListener("visibilitychange", onVisibilityChange);
  if (!wasHidden) {
    startClock();
  }

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
 * Whether a report describes a load the automatic reload fixed on its own: a
 * failed load, one automatic reload, and that reload hydrated. The user saw a
 * reload and never the recovery screen.
 *
 * @param report - The report the failed load left behind
 * @returns `true` for a recovered reload; `false` when the recovery screen was
 *   shown (the reload failed too, no reload was allowed, or the page timed out)
 */
export function isRecoveredReload(report: HydrationFailureReport): boolean {
  return (
    report.reason === "load-error" &&
    report.reloadedAt !== null &&
    report.failures === 1
  );
}

/**
 * Whether the wall clock ran ahead of the page's monotonic clock while it
 * loaded: the device slept, or its clock was changed. A timeout in such a
 * report did not keep anyone waiting for its full length.
 *
 * @param report - The report the failed load left behind
 * @returns `true` when the gap exceeds {@link HYDRATION_CLOCK_GAP_MS}; `false`
 *   when it does not, or when a report has no wall-clock reading
 */
export function hasClockGap(report: HydrationFailureReport): boolean {
  if (report.wallClockMs == null || report.failedAfterMs == null) {
    return false;
  }
  return report.wallClockMs - report.failedAfterMs > HYDRATION_CLOCK_GAP_MS;
}

/**
 * Whether a timeout fired before {@link HYDRATION_TIMEOUT_MS} had passed on the
 * page's own clock. The timer counts only visible time, so in a browser that
 * runs timers normally it can never fire sooner than that after navigation
 * start. One that did ran its timers early: link scanners that pre-open emailed
 * links do, several tabs within the same second and no file loaded, and so can
 * a browser restoring a session. Such a report says nothing about how long
 * anyone waited for the bundle.
 *
 * A device that slept also leaves a short page clock, since the page clock
 * stops during sleep. That case has its own tag ({@link hasClockGap}) and is
 * not counted here.
 *
 * @param report - The report the failed load left behind
 * @returns `true` for a timeout reported under {@link HYDRATION_TIMEOUT_MS}
 *   with no clock gap; `false` for a load error, a sleeping device, or a report
 *   with no page-clock reading
 */
export function timedOutEarly(report: HydrationFailureReport): boolean {
  return (
    report.reason === "timeout" &&
    report.failedAfterMs != null &&
    report.failedAfterMs < HYDRATION_TIMEOUT_MS &&
    !hasClockGap(report)
  );
}

/**
 * Stands the watchdog down and reports any earlier failed load to Sentry.
 * Call once, after hydration commits.
 *
 * A report present here means the page did hydrate in the end: after the
 * automatic reload, after a manual one, or late, past the timeout. A
 * recovered reload ({@link isRecoveredReload}) goes to Sentry Logs, which keep
 * its rate visible without raising an issue for each flaky download. A timeout
 * that fired early ({@link timedOutEarly}) is an info issue of its own, so the
 * warning issues, one per reason, count only pages someone waited on.
 */
export function markHydrated(): void {
  window[WATCHDOG_GLOBAL]?.done();

  const report = consumeHydrationFailureReport();
  // A browser under automation (a crawler, a link previewer, a test runner)
  // fast-forwards or starves timers, so its failures say nothing about users.
  if (!report || report.automated) {
    return;
  }

  // Time from navigation start to hydration on this successful load.
  const hydratedAfterMs = Math.round(performance.now());

  if (isRecoveredReload(report)) {
    Sentry.logger.info("App bundle reloaded after a failed load", {
      label: "Hydration",
      reason: report.reason,
      path: report.path,
      failures: report.failures,
      hydratedAfterMs,
      ...(report.source ? { source: report.source } : {}),
    });
    return;
  }

  const tags = {
    hydration_failure: report.reason,
    hydration_auto_reloaded: report.reloadedAt !== null ? "yes" : "no",
    hydration_tab_hidden: report.hidden ? "yes" : "no",
    hydration_clock_gap: hasClockGap(report) ? "yes" : "no",
  };

  if (timedOutEarly(report)) {
    Sentry.captureMessage("Hydration timeout fired before its clock ran out", {
      level: "info",
      fingerprint: ["hydration-failure", "timeout-early"],
      tags,
      extra: { ...report, hydratedAfterMs },
    });
    return;
  }

  Sentry.captureMessage("App bundle failed to load before hydration", {
    level: "warning",
    // One issue per reason, not one per failing chunk URL.
    fingerprint: ["hydration-failure", report.reason],
    tags,
    extra: { ...report, hydratedAfterMs },
  });
}
