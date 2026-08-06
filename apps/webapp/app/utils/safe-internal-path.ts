/**
 * Internal-path validation for user-influenced link targets.
 *
 * Note content is stored as text and rendered through Markdoc, so a link
 * target can originate from data a user controls. This module answers one
 * question — "does this string point somewhere inside our own app?" — and is
 * the guard the Markdoc link renderer applies before emitting an anchor.
 *
 * Client-safe by design: it takes no `window` access and resolves against a
 * fixed dummy origin, so it behaves identically during SSR and in the browser.
 *
 * @see {@link file://./../components/markdown/link-component.tsx} the consumer
 * @see {@link file://./http.server.ts} `safeRedirect`, which guards redirect
 *   targets. It solves a related problem and documents the same URL traps, but
 *   is server-only (it reads `SERVER_URL`) and additionally accepts absolute
 *   same-origin URLs. Deliberately left independent of this helper: it sits on
 *   the auth redirect path, where any behavioural change carries real risk.
 */

/**
 * Origin used purely as a resolution base. Any input that escapes the base —
 * `//evil.com`, `/\evil.com`, `https://evil.com` — resolves to a different
 * origin, which is exactly the signal we test for. Using a fixed constant
 * rather than the real origin keeps the check identical on server and client.
 */
const RESOLUTION_BASE = "https://internal.invalid";

/**
 * Whether `to` is a safe, in-app path we are willing to render as a link.
 *
 * Accepts only root-relative paths that stay on our own origin. Rejects
 * absolute URLs, alternative schemes (`javascript:`, `data:`, `vbscript:`),
 * protocol-relative `//host`, and the backslash variants `/\host` / `/\\host`
 * — browsers treat `\` like `/` in http(s) URLs, so those resolve off-origin
 * despite starting with a single `/`. A plain prefix check misses them; URL
 * resolution does not.
 *
 * @param to - Candidate link target, from note content and therefore untrusted
 * @returns `true` when `to` is a root-relative path on our own origin
 */
export function isInternalPath(to: unknown): to is string {
  if (typeof to !== "string" || !to.startsWith("/")) {
    return false;
  }

  // Internal router routes (manifest and friends) are not user destinations.
  if (to.startsWith("/__")) {
    return false;
  }

  try {
    return new URL(to, RESOLUTION_BASE).origin === RESOLUTION_BASE;
  } catch {
    return false;
  }
}
