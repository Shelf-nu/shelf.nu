/**
 * Tests for the scan lock, plus a source check that both scanners still take
 * it before every lookup.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo, or `@/`-aliased paths.
 *
 * @see ./scan-lock.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

import { endScan, tryBeginScan } from "./scan-lock";

function refs() {
  return { processing: { current: false }, lastScan: { current: "" } };
}

test("accepts a frame when idle and takes the lock", () => {
  const { processing, lastScan } = refs();

  assert.equal(tryBeginScan(processing, lastScan, "qr-1"), true);
  assert.equal(processing.current, true);
  assert.equal(lastScan.current, "qr-1");
});

test("refuses every frame while a lookup holds the lock", () => {
  const { processing, lastScan } = refs();
  tryBeginScan(processing, lastScan, "qr-1");

  assert.equal(tryBeginScan(processing, lastScan, "qr-1"), false);
  assert.equal(tryBeginScan(processing, lastScan, "qr-2"), false);
  assert.equal(lastScan.current, "qr-1", "a refused frame changes nothing");
});

test("accepts a new code once the lock is released", () => {
  const { processing, lastScan } = refs();
  tryBeginScan(processing, lastScan, "qr-1");
  endScan(processing);

  assert.equal(processing.current, false);
  assert.equal(tryBeginScan(processing, lastScan, "qr-2"), true);
});

test("refuses the same code until its cooldown clears", () => {
  const { processing, lastScan } = refs();
  tryBeginScan(processing, lastScan, "qr-1");
  endScan(processing);

  assert.equal(tryBeginScan(processing, lastScan, "qr-1"), false);
  lastScan.current = ""; // what the cooldown timer does
  assert.equal(tryBeginScan(processing, lastScan, "qr-1"), true);
});

/**
 * The top-level statements of `handleBarCodeScanned`'s callback body in a
 * screen, up to the first one that awaits, with whitespace collapsed.
 */
function statementsBeforeFirstAwait(relativePath: string): string[] {
  const file = path.resolve(__dirname, "..", relativePath);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  let found: string[] | undefined;
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === "handleBarCodeScanned" &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const fn = node.initializer.arguments[0];
      if (fn && ts.isArrowFunction(fn) && ts.isBlock(fn.body)) {
        found = [];
        for (const statement of fn.body.statements) {
          const text = statement.getText(source).replace(/\s+/g, " ");
          if (/\bawait\b/.test(text)) break;
          found.push(text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, `${relativePath}: handleBarCodeScanned not found`);
  return found;
}

for (const screen of [
  "components/scanner/scanner-screen.tsx",
  "app/(tabs)/audits/scan.tsx",
]) {
  test(`${screen} takes the scan lock before any lookup`, () => {
    // The camera handler never turns off during a lookup (that would switch
    // the iOS torch off), so this check is the only guard against a second
    // frame starting a second lookup.
    assert.ok(
      statementsBeforeFirstAwait(screen).includes(
        "if (!tryBeginScan(isProcessingRef, lastScanRef, data)) return;"
      ),
      `${screen}: handleBarCodeScanned must call tryBeginScan before awaiting`
    );
  });
}
