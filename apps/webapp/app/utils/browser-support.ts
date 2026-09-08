/**
 * Detects browsers that cannot run the client bundle and marks the document
 * so the app fails with an explicit message instead of a spinner that never
 * resolves.
 *
 * The supported floor is Chrome 98, Edge 98, Firefox 94 and Safari 15.4. The
 * client bundle is compiled for exactly that set (`build.target` in
 * `vite.config.ts`), so newer syntax is lowered and a browser below the floor
 * fails only on runtime APIs the bundle calls without guards. The check below
 * runs as a classic inline script in the document `<head>`, written in ES5 so
 * that every browser can parse it, before any module script executes. It
 * probes `Object.hasOwn`, `structuredClone` and `Array.prototype.at`, which
 * all arrive together at that floor. Change the floor here and in
 * `vite.config.ts` together.
 *
 * `crypto.randomUUID` is deliberately not probed: it is undefined in insecure
 * contexts (plain-HTTP self-hosted instances) even in current browsers, and
 * client code goes through `generateClientId` instead.
 *
 * When a probe fails, {@link UNSUPPORTED_BROWSER_ATTRIBUTE} is set on `<html>`.
 * {@link BROWSER_SUPPORT_GATE_STYLES}, inlined in the same `<head>`, keeps the
 * "browser out of date" screen (`app/root.tsx`) hidden by default and reveals
 * it for that attribute, and `entry.client.tsx` skips hydration via
 * {@link isUnsupportedBrowser}. The screen carries no `hidden` attribute, so
 * once revealed it is exposed to assistive technology like any other content.
 */
export const UNSUPPORTED_BROWSER_ATTRIBUTE = "data-unsupported-browser";

/** `id` of the "browser out of date" screen rendered by `app/root.tsx`. */
export const UNSUPPORTED_BROWSER_SCREEN_ID = "unsupported-browser";

/**
 * Inline stylesheet for the gate. Lives in `<head>` next to the check script
 * rather than in a linked stylesheet, so the default hidden state applies
 * before any external resource loads.
 */
export const BROWSER_SUPPORT_GATE_STYLES = `#${UNSUPPORTED_BROWSER_SCREEN_ID}{display:none}html[${UNSUPPORTED_BROWSER_ATTRIBUTE}] #${UNSUPPORTED_BROWSER_SCREEN_ID}{display:block}`;

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
