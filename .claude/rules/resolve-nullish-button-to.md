# Never Bind a Nullable Value Straight to `<Button to>`

`Button` (`~/components/shared/button`) picks its element with
`isLinkProps = "to" in props && props.to !== undefined`. That makes a nullish
`to` fail **silently, in two different ways** — no console warning, no thrown
error, nothing a passing CI run would surface:

| `to={…}`    | Renders                  | What the user gets                                                                                            |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `undefined` | `<button type="button">` | **Dead control.** No href, no onClick, and `type="button"` means it can't even submit. Clicking does nothing. |
| `null`      | `<a href="/">`           | Valid link to the **wrong place** — react-router resolves nullish to the site root.                           |
| `"/assets"` | `<a href="/assets">`     | Correct.                                                                                                      |

**Typecheck does NOT protect you here.** `LinkButtonProps.to` is `string`, but
the `ButtonProps` union also contains `CustomComponentButtonProps` with an
`[key: string]: any` index signature, which swallows the constraint — verified
with the compiler: `<Button to={maybeNull}>` emits zero diagnostics. Reviews and
`pnpm webapp:validate` cannot catch this class. Only clicking the button can.

This shipped: `/assets/new` rendered `<AssetForm>` without a `referer` prop, so
Cancel was inert for every user creating an asset.

**A bare `??` is NOT enough.** There is a third failure mode that keeps the link
valid but useless: any navigation that stays on the route re-runs the loader with
`Referer: <the page you are on>`, so Cancel starts pointing at itself. Verified:
on `/assets/new`, picking a **Category** navigates to `/assets/new?category=<id>`
and Cancel became `/assets/new`. Clicking it does nothing. Unit tests and
typecheck were green through all of this; only clicking the button found it.

**Snapshot the referer on mount.** The Referer header is only meaningful at the
moment the user arrives; re-reading it later gives you this page's own URL. Take
it once with `useState` and keep the resolver as the safety net. This is not a
stale-prop bug — say so in a comment, or a reviewer will "fix" it back.

Use the shared resolver, which handles all three cases and compares only the
pathname so returning to a _filtered_ list still works:

```tsx
// ❌ Bad — referer is `string | null | undefined`
<Button to={referer} variant="secondary">
  Cancel
</Button>;

// ❌ Still bad — survives null/undefined, but self-references after an
// in-route navigation, leaving a link that goes nowhere
const cancelTo = referer ?? "/assets";

// ✅ Good — captured once on mount, then resolved
const [initialReferer] = useState(referer);
const cancelTo = resolveCancelTo({
  referer: initialReferer,
  currentPathname: useLocation().pathname,
  fallback: id ? `/assets/${id}` : "/assets",
});
<Button to={cancelTo} variant="secondary">
  Cancel
</Button>;
```

`getRefererPath()` returns `null` on direct navigation, bookmarks, and
restrictive `Referrer-Policy`, so **every** referer-derived destination needs
this. When you fix one, grep the sibling forms: this travels in packs (assets,
kits, locations all bind the same prop).

Pinned by `app/utils/cancel-destination.test.ts` and
`app/components/shared/button-nullish-to.test.tsx`. **Verify a Cancel change in
a browser** — this class is invisible to both the compiler and unit tests.
