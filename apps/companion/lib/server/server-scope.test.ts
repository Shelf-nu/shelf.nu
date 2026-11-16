/**
 * Tests for the server-switch counter.
 *
 * @see {@link file://./server-scope.ts}
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serverScope } from "./server-scope";

describe("serverScope", () => {
  it("moves on every bump, so a value read earlier no longer matches", () => {
    const before = serverScope.current();

    serverScope.bump();

    assert.notEqual(serverScope.current(), before);
    assert.equal(serverScope.current(), before + 1);
  });
});
