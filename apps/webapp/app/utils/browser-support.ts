/**
 * Detects browsers that cannot run the client bundle and marks the document
 * so the app fails with an explicit message instead of a spinner that never
 * resolves.
 *
 * The bundle is compiled for Vite's "baseline widely available" browser set
 * (see `build.target` in `vite.config.ts`), so older browsers parse it but
 * lack some runtime APIs the bundle calls without guards. The check below runs
 * as a classic inline script in the document `<head>`, written in ES5 so that
 * every browser can parse it, before any module script executes. It probes
 * `Object.hasOwn`, `structuredClone` and `Array.prototype.at`, all available
 * from Chrome 98, Firefox 94 and Safari 15.4 onwards. The probe is
 * deliberately narrower than the build target: it blocks only browsers known
 * to fail at runtime.
 *
 * `crypto.randomUUID` is deliberately not probed: it is undefined in insecure
 * contexts (plain-HTTP self-hosted instances) even in current browsers, and
 * client code goes through `generateClientId` instead.
 *
 * When a probe fails, {@link UNSUPPORTED_BROWSER_ATTRIBUTE} is set on `<html>`.
 * That attribute reveals the "browser out of date" screen rendered by
 * `app/root.tsx` (rule in `app/styles/global.css`) and tells
 * `entry.client.tsx`, via {@link isUnsupportedBrowser}, to skip hydration.
 */
export const UNSUPPORTED_BROWSER_ATTRIBUTE = "data-unsupported-browser";

export const BROWSER_SUPPORT_CHECK_SCRIPT = `(function () {
  var supported =
    typeof Object.hasOwn === "function" &&
    typeof structuredClone === "function" &&
    typeof Array.prototype.at === "function";
  if (!supported) {
    document.documentElement.setAttribute("${UNSUPPORTED_BROWSER_ATTRIBUTE}", "");
  }
})();`;

/** Whether the inline check flagged the current browser as unsupported. */
export function isUnsupportedBrowser(): boolean {
  return document.documentElement.hasAttribute(UNSUPPORTED_BROWSER_ATTRIBUTE);
}
