/**
 * Tests for the read tracker: loading ends only when the data that ends it
 * has arrived, whichever order overlapping reads finish in.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createReadTracker } from "./read-tracker";

/** A tracker plus a log of every loading change. */
function tracker() {
  const loading: boolean[] = [];
  const reads = createReadTracker((value) => loading.push(value));
  return { reads, loading, isLoading: () => loading.at(-1) ?? false };
}

describe("createReadTracker", () => {
  test("a lone foreground read turns loading on, then off", () => {
    const { reads, loading } = tracker();
    const id = reads.begin(true);
    assert.equal(reads.isLatest(id), true);
    reads.end(id);
    assert.deepEqual(loading, [true, false]);
  });

  test("a background read never touches loading on its own", () => {
    const { reads, loading } = tracker();
    reads.end(reads.begin(false));
    assert.deepEqual(loading, []);
  });

  test("an overtaken foreground read leaves loading on until the newer read ends", () => {
    const { reads, isLoading } = tracker();
    const first = reads.begin(true);
    const second = reads.begin(true);
    reads.end(first);
    assert.equal(isLoading(), true, "the newer read is still running");
    assert.equal(reads.isLatest(first), false);
    reads.end(second);
    assert.equal(isLoading(), false);
  });

  test("a background read that overtakes a foreground one ends the loading", () => {
    const { reads, isLoading } = tracker();
    const foreground = reads.begin(true);
    const background = reads.begin(false);
    reads.end(foreground);
    assert.equal(isLoading(), true);
    reads.end(background);
    assert.equal(isLoading(), false);
  });

  test("loading ends with the overtaken read when the newer one already finished", () => {
    const { reads, isLoading } = tracker();
    const foreground = reads.begin(true);
    const background = reads.begin(false);
    reads.end(background);
    assert.equal(isLoading(), true, "the foreground read still owns it");
    reads.end(foreground);
    assert.equal(isLoading(), false);
  });
});
