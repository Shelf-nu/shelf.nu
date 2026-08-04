---
description: User-supplied strings placed into note content (booking, audit, asset — anything rendered through Markdoc) must be sanitized against Markdoc-tag injection. Sanitize at write time.
globs:
  [
    "apps/webapp/app/modules/**/service.server.ts",
    "apps/webapp/app/modules/booking-note/**",
    "apps/webapp/app/modules/audit/note-content.server.ts",
    "apps/webapp/app/utils/markdoc-wrappers.ts",
  ]
---

# Sanitize User Input in Markdoc-Rendered Notes

Booking / audit / asset notes are stored as text and rendered through Markdoc
(`MarkdownViewer` + `markdocConfig`). Any `{% … %}` in stored note content is
parsed as a live Markdoc **tag** at render time, so a user-controlled string
(kit name, a title used as literal text, unit of measure, free-form note body)
spliced RAW into note content is a **stored XSS**: a value like
`{% link to="javascript:alert(document.cookie)" /%}` renders as a live tag for
anyone (incl. admins) who views the note. The repo contract is
**sanitize-at-write** — the feed renders note content raw, so write-time
stripping is what keeps injected tags out.

**Defence in depth, not a substitute:** `LinkComponent` now refuses any `to`
that is not an internal path (`isInternalPath`, `~/utils/safe-internal-path`),
so an injected link renders as plain text. That guard exists because
write-time sanitization cannot reach notes ALREADY stored in the database — it
is not a licence to skip sanitizing. Every other tag (`booking_status`,
`assets_list`, `tag`, `category_badge`) still renders if injected, which forges
the audit trail even without a working link.

When you splice ANY user-controlled string into note content:

- Prefer a **wrapper** from `~/utils/markdoc-wrappers.ts` (`wrapLinkForNote`,
  `wrapKitsWithDataForNote`, …) — they place the value inside a quoted, escaped
  Markdoc attribute and never emit a raw tag.
- If the value must appear as **literal text** (not inside a tag), strip the
  delimiters first with `stripMarkdocDelimiters` (`~/utils/markdoc-sanitize`).
  It loops until the string stops changing: a single `.replace()` pass splices
  the remainder into a NEW delimiter, so `{{% … /%}}` would come out as a
  working `{% … /%}` tag. Never hand-roll a one-pass strip.
- A length/format check is NOT protection — `Kit.name`, `Asset.title`,
  `unitOfMeasure`, note bodies have no `{`/`%`/`}` restriction.
- Watch for **indirection**: the raw value is often a few hops away
  (`changes[]`, `parts[]`, `subjects`, a local `escape()` that only handles
  markdown emphasis). Fix where the user value ENTERS the string.

```ts
// ❌ Bad — raw user input becomes a live Markdoc tag when the note renders
content = `checked out (in kit ${kit.name})`;

// ✅ Good — strip delimiters before splicing as literal text …
content = `checked out (in kit ${stripMarkdocDelimiters(kit.name)})`;
// … or wrap it in an escaped attribute
content = `checked out (${wrapKitsWithDataForNote([kit], "checked out")})`;
```

Add a regression test asserting a value containing `{% … %}` can't inject a tag.
Assert on the PARSE, not the string — `[...Markdoc.parse(content).walk()]`
filtered to `type === "tag"` must be empty. A substring check misses payloads
that only become tags after concatenation.

When you find one unsanitized splice, grep sibling note builders — this class
travels in packs (asset unit-of-measure and audit notes were prior instances;
the 2026-07-31 sweep found live splices across booking, kit, asset, location,
audit and model-request in one pass).
