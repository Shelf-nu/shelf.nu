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

test("a link tag links to the app screen for its page", () => {
  assert.deepEqual(
    markdocToSegments(
      `${SAM} checked out via {% link to="/bookings/bk-1" text="Shoot &quot;B&quot;" /%}.`,
      format,
      BASE,
      SYSTEM
    ),
    [
      { type: "text", text: "Sam Lee checked out via " },
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
    [{ type: "text", text: "Renamed to Shoot at canon.com" }]
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

test("typed placeholder characters stay text next to a held link", () => {
  const content = `\uE0000\uE001 {% link to="/kits/k-1" text="Kit A" /%}`;
  const segments = markdocToSegments(content, format, BASE, SYSTEM);
  assert.equal(
    segments.map((segment) => segment.text).join(""),
    "\uE0000\uE001 Kit A"
  );
  assert.equal(segments.filter((segment) => segment.type === "link").length, 1);
});

test("held runs do not leave extra spaces where they meet the text", () => {
  assert.equal(
    markdocToSegments(
      `{% name text=" Shoot " /%}  ${SAM} `,
      format,
      BASE,
      SYSTEM
    )
      .map((segment) => segment.text)
      .join(""),
    "Shoot Sam Lee"
  );
});

test("a chips=true value links its URL but not a bare domain", () => {
  const linkUrls = (content: string) =>
    markdocToSegments(content, format, BASE, SYSTEM).flatMap((segment) =>
      segment.type === "link" ? [segment.url] : []
    );
  assert.deepEqual(
    linkUrls('Set to {% name text="manual.example.com" chips=true /%}'),
    []
  );
  assert.deepEqual(
    linkUrls('Set to {% name text="https://x.com/m.pdf" chips=true /%}'),
    ["https://x.com/m.pdf"]
  );
});

test("a Markdown link to a URL that does not parse stays text", () => {
  assert.deepEqual(
    markdocToSegments("[Manual](https://%) here", format, BASE, COMMENT).filter(
      (segment) => segment.type === "link"
    ),
    []
  );
});

test("a link tag to a page the app has no screen for reads as its text", () => {
  // A team member and a location only have web pages, which the in-app
  // browser would show behind the web login.
  assert.deepEqual(
    markdocToSegments(
      `${SAM} moved it to {% link to="/locations/loc-1" text="Studio" /%}, ` +
        'kit {% link to="/kits/k-1" text="Kit A" /%}',
      format,
      BASE,
      SYSTEM
    ),
    [
      { type: "text", text: "Sam Lee moved it to Studio, kit " },
      { type: "link", text: "Kit A", url: "https://app.shelf.nu/kits/k-1" },
    ]
  );
});

test("a typed name that spells out chips=true stays text", () => {
  assert.deepEqual(
    markdocToSegments(
      'Renamed to {% name text="chips=true https://evil.example" /%}',
      format,
      BASE,
      SYSTEM
    ).filter((segment) => segment.type === "link"),
    []
  );
});

test("category and tag badge names stay text", () => {
  assert.deepEqual(
    markdocToSegments(
      'Set {% category_badge name="see acme.com" color="#575757" /%} and ' +
        '{% tag name="https://evil.example" /%}',
      format,
      BASE,
      SYSTEM
    ),
    [{ type: "text", text: "Set see acme.com and https://evil.example" }]
  );
});

test("a % in a typed name keeps the name as text, never a link", () => {
  assert.deepEqual(
    markdocToSegments(
      'Sam renamed the booking to {% name text="50% off at evil-login.com" /%}.',
      format,
      BASE,
      SYSTEM
    ),
    [
      {
        type: "text",
        text: "Sam renamed the booking to 50% off at evil-login.com.",
      },
    ]
  );
});

test("a % in a link tag's text and in a badge still reads as their words", () => {
  const segments = markdocToSegments(
    '{% link to="/bookings/bk-1" text="Sale 50% at shop.example" /%} got ' +
      '{% tag name="100% evil.example" /%}',
    format,
    BASE,
    SYSTEM
  );
  assert.equal(
    segments.map((segment) => segment.text).join(""),
    "Sale 50% at shop.example got 100% evil.example"
  );
  assert.deepEqual(
    segments.filter((segment) => segment.type === "link"),
    [
      {
        type: "link",
        text: "Sale 50% at shop.example",
        url: `${BASE}/bookings/bk-1`,
      },
    ]
  );
  assert.equal(
    markdocToPlainText(
      'Renamed to {% name text="50% off" /%} and {% link to="/x" text="10% more" /%}',
      format
    ),
    "Renamed to 50% off and 10% more"
  );
});

test("a tag no reader understands never links what it holds", () => {
  assert.deepEqual(
    markdocToSegments(
      'Moved {% place value="evil-login.com %} broken /%} here',
      format,
      BASE,
      SYSTEM
    ).filter((segment) => segment.type === "link"),
    []
  );
});
