# Every Scanner Blocker Needs a Test

A scanner blocker is the row's answer to "why can this not go". A **missing**
one is not a missing warning: the row has no quantity input, so the drawer omits
it from the payload, the service skips it as unactionable, and the submission
reports success. The operator is told the hand-over happened when nothing moved.

That failure is invisible to every check we run. Nothing throws, the button is
green, and the drawer components are impractical to mount (their import graph
reaches canvas), so no test sees the list at all. Three shipped from the custody
drawers in one PR, each found by hand in a browser.

**Derive the list in a pure builder, not inside the component**, give every
blocker a stable `id`, and pin the set:

```ts
// ✅ uses/custody-blockers.tsx: a pure function of the scanned rows
export function buildAssignCustodyBlockers({ items, removeAssetsFromList, removeItemsFromList })
  : { blockerConfigs: BlockerConfig[]; onResolveAll: () => void }

// uses/custody-blockers.test.tsx
const EXPECTED_ASSIGN_IDS = ["qty-nothing-free", "assets-checked-out", ...];
expect(built.blockerConfigs.map((b) => b.id)).toEqual(EXPECTED_ASSIGN_IDS);
```

That manifest assertion is the point: adding a blocker without a case fails the
suite instead of shipping untested. Each id then needs a row in that state
raising it, and a healthy row not raising it.

❌ Deriving `blockerConfigs` inline in the drawer, or adding a blocker with no
`id` and no case. Neither can be asserted on.

**Quantity-tracked rows are where these go wrong.** `Asset.status` and kit
membership are whole-row facts, so a status blocker scoped to INDIVIDUAL cannot
catch a quantity row with nothing free, and one that is not scoped refuses rows
with plenty of stock. A quantity row needs its own blocker keyed on the units
that drawer can actually move.

`custody-blockers.tsx` is the reference. The other scanner drawers still derive
their lists inline. When you add or change a blocker in one, extract that
drawer's derivation the same way rather than adding to the inline array.
