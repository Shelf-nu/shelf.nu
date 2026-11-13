/**
 * Tests for the camera frame gate.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo, or `@/`-aliased paths. The screen
 * checks parse the scanner sources with the TypeScript compiler instead of
 * mounting them.
 *
 * @see ./camera-frame-gate.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

import { createFrameGate, type FrameGateState } from "./camera-frame-gate";

type Frame = { data: string };

/** A mutable stand-in for the screen state a hook would keep in a ref. */
function setup(initial: FrameGateState<Frame>) {
  const state = { current: initial };
  const gate = createFrameGate(() => state.current);
  return { state, gate };
}

test("forwards frames to the handler while nothing blocks them", () => {
  const seen: string[] = [];
  const { gate } = setup({
    ignore: false,
    handle: (e) => seen.push(e.data),
  });

  gate({ data: "qr-1" });
  gate({ data: "qr-2" });

  assert.deepEqual(seen, ["qr-1", "qr-2"]);
});

test("drops frames while ignore is set and resumes when it clears", () => {
  const seen: string[] = [];
  const handle = (e: Frame) => seen.push(e.data);
  const { state, gate } = setup({ ignore: true, handle });

  gate({ data: "while-card-up" });
  state.current = { ignore: false, handle };
  gate({ data: "after-dismiss" });

  assert.deepEqual(seen, ["after-dismiss"]);
});

test("the same gate calls whichever handler is current", () => {
  const seen: string[] = [];
  const { state, gate } = setup({
    ignore: false,
    handle: (e) => seen.push(`old:${e.data}`),
  });

  gate({ data: "a" });
  state.current = { ignore: false, handle: (e) => seen.push(`new:${e.data}`) };
  gate({ data: "b" });

  assert.deepEqual(seen, ["old:a", "new:b"]);
});

/** Every .tsx file under app/, as [relative path, source]. */
/** The main scanner screen, relative to the app root. */
const MAIN_SCANNER = path.join("components", "scanner", "scanner-screen.tsx");

function appScreens(): [string, string][] {
  // Screens live under app/ (routes) and components/ (screens a route
  // renders, such as the main scanner); paths are relative to the app root.
  const root = path.resolve(__dirname, "..");
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx"))
        out.push([path.relative(root, full), readFileSync(full, "utf8")]);
    }
  };
  walk(path.join(root, "app"));
  walk(path.join(root, "components"));
  return out;
}

/** Every CameraView element and useCameraScanHandler call in a screen. */
function cameraSites(source: string) {
  const file = ts.createSourceFile(
    "screen.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const cameras: { spread: boolean; handlers: string[] }[] = [];
  const gateCalls: string[][] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(file) === "CameraView"
    ) {
      const props = node.attributes.properties;
      cameras.push({
        spread: props.some(ts.isJsxSpreadAttribute),
        handlers: props
          .filter(ts.isJsxAttribute)
          .filter((a) => a.name.getText(file) === "onBarcodeScanned")
          .map((a) =>
            a.initializer && ts.isJsxExpression(a.initializer)
              ? a.initializer.expression?.getText(file) ?? ""
              : a.initializer?.getText(file) ?? ""
          ),
      });
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(file) === "useCameraScanHandler"
    ) {
      gateCalls.push(
        node.arguments.map((arg) => arg.getText(file).replace(/\s+/g, " "))
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { cameras, gateCalls };
}

test("every camera keeps one stable onBarcodeScanned", () => {
  // A conditional handler (`busy ? undefined : handler`) turns iOS scanning
  // off and on per scan, which switches the torch off. Screens gate frames
  // through useCameraScanHandler instead, and pass it with no props spread
  // that could replace it.
  const screens = appScreens().map(([file, source]) => ({
    file,
    ...cameraSites(source),
  }));
  assert.ok(
    screens.some((s) => s.file === MAIN_SCANNER && s.cameras.length > 0),
    "the main scanner must be found"
  );
  for (const { file, cameras } of screens) {
    for (const camera of cameras) {
      assert.equal(camera.spread, false, `${file} spreads props on CameraView`);
      assert.deepEqual(
        camera.handlers,
        ["handleCameraScan"],
        `${file} passes onBarcodeScanned=${JSON.stringify(camera.handlers)}`
      );
    }
  }
});

test("the main scanner ignores frames while a View result card is up", () => {
  const scanner = appScreens().find(([file]) => file === MAIN_SCANNER);
  assert.ok(scanner, "the main scanner must be found");
  const { gateCalls } = cameraSites(scanner[1]);
  assert.deepEqual(gateCalls, [
    [
      "handleBarCodeScanned",
      'Boolean(scanResult && action === "view" && !isBookingMode)',
    ],
  ]);
});
