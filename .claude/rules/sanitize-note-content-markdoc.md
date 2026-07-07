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
`{% link to="javascript:alert(document.cookie)" /%}` renders as a live link that
fires for anyone (incl. admins) who views the note. The repo contract is
**sanitize-at-write** — the feed renders note content raw, so write-time
stripping is what keeps injected tags out.

When you splice ANY user-controlled string into note content:

- Prefer a **wrapper** from `~/utils/markdoc-wrappers.ts` (`wrapLinkForNote`,
  `wrapKitsWithDataForNote`, …) — they place the value inside a quoted, escaped
  Markdoc attribute and never emit a raw tag.
- If the value must appear as **literal text** (not inside a tag), strip the
  delimiters first with `stripMarkdocDelimiters` (`~/modules/audit/note-content.server`).
- A length/format check is NOT protection — `Kit.name`, `Asset.title`,
  `unitOfMeasure`, note bodies have no `{`/`%`/`}` restriction.

```ts
// ❌ Bad — raw user input becomes a live Markdoc tag when the note renders
content = `checked out (in kit ${kit.name})`;

// ✅ Good — strip delimiters before splicing as literal text …
content = `checked out (in kit ${stripMarkdocDelimiters(kit.name)})`;
// … or wrap it in an escaped attribute
content = `checked out (${wrapKitsWithDataForNote([kit], "checked out")})`;
```

Add a regression test asserting a value containing `{% … %}` can't inject a tag.
When you find one unsanitized splice, grep sibling note builders — this class
travels in packs (asset unit-of-measure and audit notes were prior instances).
