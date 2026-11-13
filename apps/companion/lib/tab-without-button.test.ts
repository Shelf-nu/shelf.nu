/**
 * Tests for the tabs that have screens but no tab-bar button.
 *
 * These run under Node's test runner via tsx, so this file and the module it
 * tests must not import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./tab-without-button.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { TAB_WITHOUT_BUTTON } from "./tab-without-button";

/** The source of the tabs layout, read as text: it imports React Native. */
const tabsLayout = readFileSync(
  path.join(__dirname, "..", "app", "(tabs)", "_layout.tsx"),
  "utf8"
);

/**
 * The `options={{ ... }}` text of one `Tabs.Screen` in the tabs layout.
 *
 * @param name - the screen's `name` prop
 */
function screenOptions(name: string): string {
  const start = tabsLayout.indexOf(`name="${name}"`);
  assert.notEqual(start, -1, `the tabs layout declares "${name}"`);
  const end = tabsLayout.indexOf("/>", start);
  return tabsLayout.slice(start, end);
}

test("a tab without a button has no slot in the tab bar", () => {
  assert.equal(TAB_WITHOUT_BUTTON.tabBarItemStyle.display, "none");
});

test("a tab without a button takes no width in the tab bar's label sum", () => {
  assert.equal(TAB_WITHOUT_BUTTON.tabBarItemStyle.width, 0);
});

test("a tab without a button is not hidden from the router", () => {
  assert.deepEqual(Object.keys(TAB_WITHOUT_BUTTON), ["tabBarItemStyle"]);
});

for (const name of ["audits", "custody"]) {
  test(`the ${name} tab leaves out its button and stays navigable`, () => {
    const options = screenOptions(name);

    assert.match(options, /\.\.\.TAB_WITHOUT_BUTTON/);
    assert.doesNotMatch(options, /\bhref\s*:/);
    assert.doesNotMatch(options, /\bhidden\s*:/);
  });
}

test("no tab in the layout is hidden from the router", () => {
  assert.doesNotMatch(tabsLayout, /\bhref\s*:\s*null|\bhidden\s*:\s*true/);
});
