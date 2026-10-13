---
description: A keyed useFetcher keeps its last response after a dialog closes. Read it through useFetcherOutcomeSinceOpen, never straight off fetcher.data.
globs: apps/webapp/app/components/**
---

# A Dialog Answers The Opening That Asked

A keyed `useFetcher` keeps its last response for as long as its owner stays
mounted, and every dialog sharing the key reads that same one. Taken straight
off `fetcher.data`, that response gets answered to the wrong opening, in both
directions:

| Read off `fetcher.data` | What the operator gets                                        |
| ----------------------- | ------------------------------------------------------------- |
| the refusal             | an old error on a fresh opening, nothing wrong this time      |
| the success             | a dialog that shuts the instant it opens, so the control dies |

**The success half is the one that ships.** A dialog rendered only while open
(`<When truthy={isOpen}>` unmounts) is mounted fresh on each opening, so its
close-on-success effect runs on mount against the PREVIOUS success. One
successful adjust left the asset page's "Adjust quantity" menu item dead for
the rest of the page's life.

Use `useFetcherOutcomeSinceOpen` (`~/hooks/use-fetcher-error-since-open`) for
both halves, or `useFetcherErrorSinceOpen` when the dialog only displays:

```tsx
// ❌ Bad — both halves act on a response that may belong to an earlier opening
const serverError =
  fetcher.data?.error != null ? fetcher.data.error.message : null;
useEffect(() => {
  if (fetcher.state === "idle" && fetcher.data && !fetcher.data.error)
    setOpen(false);
}, [fetcher.state, fetcher.data]);

// ✅ Good
const outcome = useFetcherOutcomeSinceOpen(fetcher, open);
const serverError = outcome.message;
useEffect(() => {
  if (outcome.status === "accepted") setOpen(false);
}, [outcome.status, setOpen]);
```

Three more things travel with this:

- **Key the fetcher per entity** (`adjust-quantity-${assetId}`), never a bare
  constant: one page can mount the same dialog twice.
- **Reset client-side validation state on open** too. It lives in component
  state that outlives the dialog content, so it is stale the same way.
- **`"error" in data` is never a success test.** `payload()` stamps
  `error: null` onto every success, so test the VALUE (see
  [[api-payload-contracts-need-a-test-on-both-sides]]).

A dialog that is mounted persistently and starts closed does not reach the
mount-while-open case, so `release-by-source-button` and `quantity-custody-list`
are correct as written. Convert one only when you are already changing it.

Pinned by `app/hooks/use-fetcher-error-since-open.test.ts`, which covers both
mounting styles. A per-dialog case asserting the dialog does not close itself
from a result it never received is what found the shipped half.
