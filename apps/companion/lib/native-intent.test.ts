/**
 * Tests for `redirectSystemPath` when reading the link fails: the router
 * starts on the start screen at launch and opens nothing while the app runs,
 * so a link it cannot read never leaves the app on an unmatched route.
 *
 * Lives in `lib/` because the test runner only collects `lib/` and `hooks/`.
 *
 * @see {@link file://./../app/+native-intent.ts}
 */
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { before, mock, test } from "node:test";

// why: no real link makes the link reader throw, and the fallback exists for
// exactly the case nobody has found yet, so the reader is made to throw.
mock.module(pathToFileURL(join(__dirname, "resource-path.ts")).href, {
  namedExports: {
    classifyResourcePath: () => {
      throw new Error("unreadable link");
    },
    nativeRouteForLink: () => {
      throw new Error("unreadable link");
    },
    splitLinkUrl: () => {
      throw new Error("unreadable link");
    },
  },
});

let nativeIntent: typeof import("../app/+native-intent");

before(async () => {
  nativeIntent = await import("../app/+native-intent");
});

test("a link the app cannot read starts on the start screen at launch", () => {
  assert.equal(
    nativeIntent.redirectSystemPath({
      path: "shelf://assets/as_1",
      initial: true,
    }),
    "/"
  );
});

test("a link the app cannot read opens nothing while the app runs", () => {
  assert.equal(
    nativeIntent.redirectSystemPath({
      path: "shelf://assets/as_1",
      initial: false,
    }),
    null
  );
});
