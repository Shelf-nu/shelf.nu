/**
 * Tests for the camera frame gate.
 *
 * Runs under Node's test runner via tsx, so neither this file nor the module
 * it tests may import React Native, Expo, or `@/`-aliased paths. The screen
 * check reads the scanner sources from disk instead of mounting them.
 *
 * @see ./camera-frame-gate.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

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
function appScreens(): [string, string][] {
  const appDir = path.resolve(__dirname, "../app");
  const out: [string, string][] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".tsx"))
        out.push([path.relative(appDir, full), readFileSync(full, "utf8")]);
    }
  };
  walk(appDir);
  return out;
}

test("every camera keeps one stable onBarcodeScanned", () => {
  // A conditional handler (`busy ? undefined : handler`) turns iOS scanning
  // off and on per scan, which switches the torch off. Screens gate frames
  // through useCameraScanHandler instead.
  const uses = appScreens().flatMap(([file, source]) =>
    [...source.matchAll(/onBarcodeScanned=\{([^}]*)\}/g)].map((m) => ({
      file,
      value: m[1].trim(),
    }))
  );
  assert.ok(
    uses.some((u) => u.file === path.join("(tabs)", "scanner.tsx")),
    "the main scanner must be found"
  );
  for (const use of uses) {
    assert.equal(
      use.value,
      "handleCameraScan",
      `${use.file} passes onBarcodeScanned={${use.value}}`
    );
  }
  // One literal handler per CameraView, so none can slip in through a spread.
  for (const [file, source] of appScreens()) {
    const cameras = (source.match(/<CameraView\b/g) ?? []).length;
    const handlers = uses.filter((u) => u.file === file).length;
    assert.equal(
      handlers,
      cameras,
      `${file} has ${cameras} CameraView and ${handlers} onBarcodeScanned`
    );
  }
});
