---
description: A blank numeric input coerces to 0 in JavaScript and in z.coerce.number(), so emptiness must be rejected or mapped to null BEFORE coercion; build numeric string fields with optionalNumberFromString / requiredNumberFromString and keep every bound at the call site
globs: ["apps/webapp/app/**/*.ts", "apps/webapp/app/**/*.tsx"]
---

# A Blank Field And A Zero Are Different Answers

"Leave it empty" and "set it to zero" are two different things an operator can
say. JavaScript gives both the same answer:

| Input   | `Number(input)` | What the operator meant |
| ------- | --------------- | ----------------------- |
| `""`    | `0`             | no answer               |
| `"   "` | `0`             | no answer               |
| `"0"`   | `0`             | zero, deliberately      |
| `" 5 "` | `5`             | five                    |
| `"abc"` | `NaN`           | a typo                  |

`Number` trims before it parses, so trimming changes no value. It matters only
for the blank decision, which is the one thing it has to be done before.

`z.coerce.number()` has the same property, so it is **not** a safe replacement
for an optional numeric field: it maps a blank submission onto a real, storable
value. Any schema that converts the string before asking whether it was blank
has already thrown the distinction away. **Emptiness is decided before
coercion, never after.**

## Use the builders, keep the bounds at the call site

`optionalNumberFromString({ blank })` and `requiredNumberFromString({ fieldName })`
(`~/utils/zod-numeric`) own exactly two things: the string to number step, and
the blank decision. They carry **no** numeric constraints and must not grow
any. Every bound stays at the call site, piped after the builder, so each field
keeps the range that is right for it. That is the part most likely to be got
wrong by someone reaching for the helper for the first time.

Enforced by the `local-rules/no-hand-coerced-numeric-transform` ESLint rule
(error, so it blocks the pre-commit hook).

```ts
// ❌ Bad, whitespace is truthy, so "   " is stored as a real valuation of 0
valuation: z
  .string()
  .optional()
  .transform((val) => (val ? Number(val) : null)),

// ✅ Good, blank decided first. No bound here because valuation has none: a
// negative value is legal, and the builder already refuses text it cannot read.
valuation: optionalNumberFromString({ blank: null }),

// ✅ Good, and where a field does have bounds they stay at the call site
minQuantity: optionalNumberFromString({ blank: null }).pipe(
  z.number().int().nonnegative("Min quantity cannot be negative").nullable()
),
```

## `.positive()` is right for a quantity and wrong for a threshold

You cannot move or check out 0 units, so a `.positive()` bound on a quantity is
correct, and the ones in this repo are. A threshold is the opposite:
`minQuantity` of 0 means "alert me when nothing is left", and
`low-stock.server.ts` treats a threshold as existing iff `minQuantity != null`
rather than testing truthiness. So the rule is not "stop using `.positive()`".
It is: **ask whether zero is a legal answer for this field, then choose the
bound.** Being wrong here is invisible, every number still renders, and the only
symptom is a field that quietly refuses or accepts an answer it should not.

## The bound lives in TWO places

A numeric field is bounded by its zod schema **and** by the `min` on its `<input
type="number">`. The browser enforces the attribute first, so a schema that
accepts a value the attribute forbids is unreachable: constraint validation
refuses the form before anything server-side runs, and nothing in this repo
compares the two.

`minQuantity` shipped exactly that way. The schema moved to `.nonnegative()`
while the input kept `min={1}`, so the out-of-stock threshold stayed impossible
to set and the tests were green throughout, because they parse the schema and
never render the control.

So when you change a numeric bound, grep the field name for its `min`, `max` and
`step` and change them together. Tightening one and not the other is the silent
half of this class.

## Sweep the file, not the diff

Blank-to-zero is silent wherever the bound accepts 0, which is exactly where it
does damage: `valuation`, `defaultValuation` and `maxOrganizations` store a zero
nobody typed. It is visible only where a piped bound happens to reject the stray
zero, as on `quantity` and `count`. So a hand-rolled transform two lines below
the one you just fixed looks fine and is not. When you find one, grep the whole
file and its sibling schemas.

The builders live in `app/utils/` on purpose, not in a `packages/*` package: the
companion app has no `zod` dependency, so there is no second consumer, and every
existing package is dependency-free. Extract only when the companion gains form
validation. See [[quantity-semantics-per-surface]] for the same "name what this
value means before reaching for a helper" discipline.
