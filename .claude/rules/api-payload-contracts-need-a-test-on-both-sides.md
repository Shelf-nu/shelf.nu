---
description: A typed cast at an I/O boundary is a claim, not a contract — pin producer and consumer with tests
globs:
  [
    "apps/webapp/app/routes/api+/**/*.ts",
    "apps/webapp/app/routes/api+/**/*.tsx",
    "apps/webapp/app/components/**/*.tsx",
    "apps/webapp/app/hooks/**/*.ts",
  ]
---

# An API Payload Type Is A Claim, Not A Contract

`useApiQuery<TData>` casts `response.json()` to its type parameter with **no
runtime validation**. The declared type describes what the consumer _hopes_
arrives. Nothing compares it to what the route actually sends, so the compiler
cannot see producer/consumer drift — and neither can review, lint or CI.

Three places in this repo erase the compiler the same way:

| Boundary                                            | Why tsc is blind                                     |
| --------------------------------------------------- | ---------------------------------------------------- |
| `useApiQuery<T>` / any `await res.json() as T`      | the cast is asserted, never checked                  |
| `Prisma.sql` + `$queryRaw<T>`                       | the SQL is a string; `T` is user-supplied            |
| `ListItemData` (`{ id: string; [x: string]: any }`) | an index signature types every field access as `any` |

## The two failure shapes — the quiet one is worse

Change what a route returns without changing its consumer and you get one of:

- **A crash.** `kit.assets` is `undefined`, `kit.assets.length` throws. Loud,
  but it can take a whole page down: children of a Radix `PopoverContent` are
  evaluated during the parent's own render, so the throw reaches the route
  `ErrorBoundary` before anyone opens the popover.
- **A silently wrong answer.** The same read behind `?.` never throws — it just
  evaluates `false` forever. A guard that never fires looks exactly like a guard
  with nothing to catch.

Both shipped from one commit (`266425e39`, the `AssetKit` pivot): the kits
popover crashed the booking activity page, and the kits bulk-actions custody
guard silently stopped firing.

## What to do

1. **Pin both sides.** The route test asserts the shape the route emits; a
   consumer test feeds a fixture of that same shape. Either alone goes green
   over a broken pair. Verify the producer test actually **fails** against the
   old payload — a regression test you never saw red is a guess.
2. **Give the compiler something to check.** When rows arrive as `any`
   (`ListItemData`), read them through a function with a declared parameter
   type instead of destructuring inline. A typed parameter turns a renamed
   field into a build error; an inline `row.whatever` never will.
3. **Never reach for `?.` or `?? []` to make a drift stop crashing.** That
   converts a caught bug into a permanent wrong answer. Fix the contract.

```ts
// ❌ Bad — the type is a claim; nothing checks it, and `?.` hides the drift
const { data } = useApiQuery<{ kits: Kit[] }>({ api: "/api/kits" });
const blocked = rows.some((kit) => kit.assets?.some((a) => a.status === "X"));

// ✅ Good — the route flattens to the shape the consumer declares, and the
// predicate takes a typed row so the field name is compiler-checked
export function someKitMemberBlocksCustodyAssignment(
  kits: { assetKits?: { asset: { status: AssetStatus } }[] }[]
): boolean { … }
```

When you change an `api+` route's payload, grep its consumers before you
commit — `useApiQuery` will not tell you, and neither will `pnpm webapp:validate`.

Related: [[raw-sql-respects-prisma-map]] for the same "a return-type cast is not
a contract" trap in raw SQL, and
[[hand-written-projections-drop-relation-fields]] for the projection that
silently drops a field the select did fetch.
