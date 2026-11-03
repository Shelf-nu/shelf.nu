/**
 * Tests for reading an activity note's Markdoc source as plain text on the
 * asset screen. Fixtures are note bodies as the webapp's note writers store
 * them.
 *
 * Runs under Node's test runner via tsx, so the module under test must not
 * import React Native, Expo or `@/`-aliased paths.
 *
 * @see ./note-plain-text.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { markdocToPlainText, markdocToSegments } from "./note-plain-text";

const format = {
  date: (iso: string) => `date(${iso})`,
  status: (status: string) => status.toLowerCase(),
};

const SAM = '{% link to="/settings/team/users/u-1" text="Sam Lee" /%}';

test("a name tag reads as the name a person typed", () => {
  assert.equal(
    markdocToPlainText(
      `${SAM} changed booking name from {% name text="Shoot" /%} to {% name text="Shoot 2" /%}.`,
      format
    ),
    "Sam Lee changed booking name from Shoot to Shoot 2."
  );
});

test("a custom field value with chips reads as its text", () => {
  assert.equal(
    markdocToPlainText(
      `${SAM} set {% name text="Manual" /%} to {% name text="https://example.com/m.pdf" chips=true /%}.`,
      format
    ),
    "Sam Lee set Manual to https://example.com/m.pdf."
  );
});

test("quotes in a name come back from their entity", () => {
  assert.equal(
    markdocToPlainText('{% name text="The &quot;A&quot; kit" /%}', format),
    'The "A" kit'
  );
});

test("an unknown tag shows the words it carries", () => {
  assert.equal(
    markdocToPlainText(
      'Moved to {% place value="Shelf 3" /%} by {% person name="Jo" /%}.',
      format
    ),
    "Moved to Shelf 3 by Jo."
  );
});

test("an unknown tag with no words leaves nothing behind", () => {
  assert.equal(
    markdocToPlainText(
      'Added {% audit_images count=2 ids="a,b" /%} photos',
      format
    ),
    "Added photos"
  );
});

test("known tags keep their own reading", () => {
  assert.equal(
    markdocToPlainText(
      '{% assets_list count=3 ids="a,b,c" action="added" /%} on {% date value="2026-10-30" /%}, now {% booking_status status="RESERVED" /%}',
      format
    ),
    "3 assets added on date(2026-10-30), now reserved"
  );
});

const BASE = "https://app.shelf.nu";
const COMMENT = { allowExternalLinks: true };
const SYSTEM = { allowExternalLinks: false };

test("a link tag links to its page on the connected server", () => {
  assert.deepEqual(
    markdocToSegments(
      `${SAM} checked out via {% link to="/bookings/bk-1" text="Shoot &quot;B&quot;" /%}.`,
      format,
      BASE,
      SYSTEM
    ),
    [
      {
        type: "link",
        text: "Sam Lee",
        url: "https://app.shelf.nu/settings/team/users/u-1",
      },
      { type: "text", text: " checked out via " },
      {
        type: "link",
        text: 'Shoot "B"',
        url: "https://app.shelf.nu/bookings/bk-1",
      },
      { type: "text", text: "." },
    ]
  );
});

test("a typed comment links its URLs and bare domains", () => {
  assert.deepEqual(
    markdocToSegments(
      "Manual: https://canon.com/r5.pdf, spares at adorama.com",
      format,
      BASE,
      COMMENT
    ),
    [
      { type: "text", text: "Manual: " },
      {
        type: "link",
        text: "https://canon.com/r5.pdf",
        url: "https://canon.com/r5.pdf",
      },
      { type: "text", text: ", spares at " },
      { type: "link", text: "adorama.com", url: "https://adorama.com" },
    ]
  );
});

test("a comment's Markdown link reads as its cleaned label", () => {
  assert.deepEqual(
    markdocToSegments(
      "See [the  **manual**](https://x.com/m.pdf) first",
      format,
      BASE,
      COMMENT
    ),
    [
      { type: "text", text: "See " },
      { type: "link", text: "the manual", url: "https://x.com/m.pdf" },
      { type: "text", text: " first" },
    ]
  );
});

test("a Markdown link URL may hold balanced parentheses", () => {
  assert.deepEqual(
    markdocToSegments(
      "[Mercury](https://en.wikipedia.org/wiki/Mercury_(planet)) is hot",
      format,
      BASE,
      COMMENT
    ),
    [
      {
        type: "link",
        text: "Mercury",
        url: "https://en.wikipedia.org/wiki/Mercury_(planet)",
      },
      { type: "text", text: " is hot" },
    ]
  );
});

test("a system note never hides an outside link behind a typed label", () => {
  // A name someone typed is shown as text, Markdown and all, as on the web.
  const segments = markdocToSegments(
    `${SAM} set custodian to {% name text="[Verify your account](https://evil.example)" /%}.`,
    format,
    BASE,
    SYSTEM
  );
  assert.equal(
    segments.some(
      (segment) =>
        segment.type === "link" && segment.url.includes("evil.example")
    ),
    false
  );
  assert.equal(
    segments.map((segment) => segment.text).join(""),
    "Sam Lee set custodian to [Verify your account](https://evil.example)."
  );
});

test("a typed name that looks like a domain stays text", () => {
  assert.deepEqual(
    markdocToSegments(
      'Renamed to {% name text="Shoot at canon.com" /%}',
      format,
      BASE,
      SYSTEM
    ),
    [
      { type: "text", text: "Renamed to " },
      { type: "text", text: "Shoot at canon.com" },
    ]
  );
});

test("a value marked chips=true links its URL, as on the web", () => {
  assert.deepEqual(
    markdocToSegments(
      `${SAM} set {% name text="Manual" /%} to {% name text="https://example.com/m.pdf" chips=true /%}.`,
      format,
      BASE,
      SYSTEM
    ).filter((segment) => segment.type === "link"),
    [
      {
        type: "link",
        text: "Sam Lee",
        url: "https://app.shelf.nu/settings/team/users/u-1",
      },
      {
        type: "link",
        text: "https://example.com/m.pdf",
        url: "https://example.com/m.pdf",
      },
    ]
  );
});

test("a link tag pointing off the Shelf server reads as its text", () => {
  assert.deepEqual(
    markdocToSegments(
      '{% link to="https://evil.example/login" text="Kit A" /%} moved',
      format,
      BASE,
      SYSTEM
    ),
    [{ type: "text", text: "Kit A moved" }]
  );
});

test("the segments read like the plain text when nothing is a link", () => {
  const content = `Status {% booking_status status="RESERVED" /%} on {% date value="2026-01-02" /%}`;
  assert.deepEqual(markdocToSegments(content, format, BASE, SYSTEM), [
    { type: "text", text: markdocToPlainText(content, format) },
  ]);
});

test("a link tag without a usable target reads as its text", () => {
  assert.deepEqual(
    markdocToSegments(
      '{% link to="javascript:x" text="Kit   **A**" /%} moved',
      format,
      BASE,
      SYSTEM
    ),
    [{ type: "text", text: "Kit A moved" }]
  );
});

test("placeholder characters typed into a note stay text", () => {
  const content = "odd \uE0000\uE001 chars, see https://x.com/a";
  const segments = markdocToSegments(content, format, BASE, COMMENT);
  assert.equal(
    segments.map((segment) => segment.text).join(""),
    "odd \uE0000\uE001 chars, see https://x.com/a"
  );
  assert.deepEqual(
    segments.filter((segment) => segment.type === "link"),
    [{ type: "link", text: "https://x.com/a", url: "https://x.com/a" }]
  );
});
