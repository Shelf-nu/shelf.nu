/**
 * Tests for `callEach`.
 *
 * @see {@link file://./call-each.ts}
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { callEach } from "./call-each";

describe("callEach", () => {
  it("calls every function even when one throws, and reports the throw", () => {
    const calls: string[] = [];
    const errors: unknown[] = [];
    const boom = new Error("boom");

    callEach(
      [
        () => calls.push("first"),
        () => {
          throw boom;
        },
        () => calls.push("third"),
      ],
      (error) => errors.push(error)
    );

    assert.deepEqual(calls, ["first", "third"]);
    assert.deepEqual(errors, [boom]);
  });

  it("swallows a throw when no error handler is given", () => {
    assert.doesNotThrow(() =>
      callEach([
        () => {
          throw new Error("ignored");
        },
      ])
    );
  });
});
