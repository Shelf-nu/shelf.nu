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
import { markdocToPlainText } from "./note-plain-text";

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
