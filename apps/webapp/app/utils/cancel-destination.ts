/**
 * Resolves where a form's Cancel control should navigate.
 *
 * Forms derive "go back" from the Referer header via `getRefererPath()`, which
 * is unreliable in three distinct ways. All three must be handled here, because
 * `<Button to>` degrades SILENTLY on each — see
 * `.claude/rules/resolve-nullish-button-to.md`.
 *
 * 1. `undefined` — the route forgot to pass the prop. `<Button to={undefined}>`
 *    renders `<button type="button">`: no href, no handler, completely inert.
 * 2. `null` — no Referer header at all (direct URL entry, bookmark, restrictive
 *    Referrer-Policy). `<Button to={null}>` renders `<a href="/">`, silently
 *    sending the user to the dashboard.
 * 3. **Self-referential** — the referer points at the page we are already on.
 *    This happens whenever something re-runs the loader without leaving the
 *    route. Concrete, verified repro: on `/assets/new`, picking a Category
 *    navigates to `/assets/new?category=<id>`; that request carries
 *    `Referer: /assets/new`, so Cancel would link back to `/assets/new` and
 *    clicking it does nothing at all. This is the failure mode that survives a
 *    naive `referer ?? fallback` guard.
 *
 * @param referer - Best-effort `pathname + search` from `getRefererPath()`
 * @param currentPathname - `useLocation().pathname` of the form's own route
 * @param fallback - Where to go when the referer is unusable. Must be a real path.
 * @returns A non-empty path safe to hand to `<Button to>`
 */
export function resolveCancelTo({
  referer,
  currentPathname,
  fallback,
}: {
  referer?: string | null;
  currentPathname: string;
  fallback: string;
}): string {
  if (!referer) {
    return fallback;
  }

  // `referer` is `pathname + search`; compare only the pathname, so returning
  // to a *filtered* list (`/assets?search=x` from `/assets/new`) still works
  // while a true self-reference is rejected.
  const [refererPathname] = referer.split("?");
  if (refererPathname === currentPathname) {
    return fallback;
  }

  return referer;
}
