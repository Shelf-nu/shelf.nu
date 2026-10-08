# Never Use Em Dashes

Do not write an em dash (`—`) or an en dash (`–`). Anywhere. User-facing
strings, code comments, JSDoc, commit messages, PR descriptions, docs, chat
replies.

Use the punctuation a person typing on a keyboard would reach for: a comma, a
colon, a full stop, parentheses, or a plain hyphen (`-`).

Em dashes read as machine-written. They also wrap badly: a long string joined by
em dashes renders as one unbroken run in a table cell or a toast, which is where
this rule came from, an import error that read
`ONE_WAY — Used up (one-way), consumed and not returned — or TWO_WAY — ...`.

```ts
// ❌ Bad
message: `Set consumptionType to ONE_WAY — used up, not returned — or TWO_WAY.`;
title: `Quantity required — this row tracks stock`;
/** The count travels separately — see MAX_REPORTED_ROW_ERRORS. */

// ✅ Good
message: `Set consumptionType to ONE_WAY (used up: not returned) or TWO_WAY.`;
title: `Quantity required`;
/** The count travels separately. See MAX_REPORTED_ROW_ERRORS. */
```

**Two nuances.** A hyphen inside a compound adjective is not a dash and is
fine (`quantity-tracked`, `one-way`). And a bare `-` as a "no value" placeholder
in a table cell is worse than a word: write `File`, `None` or leave the cell
empty.

When you edit a file, fix the em dashes in the lines you touch. Do not sweep
files you are not otherwise changing, that is churn a reviewer cannot check.
