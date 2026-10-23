/**
 * Tests for where the asset screens open in each tab stack.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * Native back (header button, iOS swipe, Android back button) only returns
 * to the audit when the asset an audit row opens is pushed onto the Audits
 * stack, and so is every screen that asset opens in turn. The Assets tab's
 * route would switch tabs, and back would land on the Assets list.
 *
 * @see ./asset-routes.ts
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ASSET_SCREEN_ROUTES,
  assetDetailHref,
  assetEditHref,
  kitDetailHref,
  type AssetHostStack,
} from "./asset-routes";

const STACKS = Object.keys(ASSET_SCREEN_ROUTES) as AssetHostStack[];

/** The `app/` route file a route pattern resolves to. */
function routeFile(pattern: string) {
  return join(__dirname, "..", "app", `${pattern}.tsx`);
}

test("an audit row opens its asset inside the Audits stack", () => {
  assert.deepEqual(assetDetailHref("audits", "asset-1"), {
    pathname: "/(tabs)/audits/asset/[id]",
    params: { id: "asset-1" },
  });
});

test("edit and kit opened from an audit's asset stay in the Audits stack", () => {
  assert.deepEqual(assetEditHref("audits", "asset-1"), {
    pathname: "/(tabs)/audits/asset/edit",
    params: { id: "asset-1" },
  });
  assert.deepEqual(kitDetailHref("audits", "kit-1"), {
    pathname: "/(tabs)/audits/kit/[id]",
    params: { id: "kit-1" },
  });
});

test("the Assets tab keeps the routes it always used", () => {
  assert.deepEqual(assetDetailHref("assets", "asset-1"), {
    pathname: "/(tabs)/assets/[id]",
    params: { id: "asset-1" },
  });
  assert.deepEqual(assetEditHref("assets", "asset-1"), {
    pathname: "/(tabs)/assets/edit",
    params: { id: "asset-1" },
  });
  assert.deepEqual(kitDetailHref("assets", "kit-1"), {
    pathname: "/(tabs)/assets/kits/[id]",
    params: { id: "kit-1" },
  });
});

test("every asset screen route stays inside its host stack", () => {
  // A route outside the host stack's folder belongs to another tab: pushing
  // it switches tabs and back no longer retraces the user's path.
  for (const stack of STACKS) {
    for (const pattern of Object.values(ASSET_SCREEN_ROUTES[stack])) {
      assert.ok(
        pattern.startsWith(`/(tabs)/${stack}/`),
        `${pattern} is outside the ${stack} stack`
      );
    }
  }
});

test("every asset screen route has a route file", () => {
  // A pattern with no file is an unmatched route at runtime.
  for (const stack of STACKS) {
    for (const pattern of Object.values(ASSET_SCREEN_ROUTES[stack])) {
      assert.ok(existsSync(routeFile(pattern)), `no route file for ${pattern}`);
    }
  }
});
