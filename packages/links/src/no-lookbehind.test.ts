/**
 * Guards the package's browser floor: regex lookbehind cannot be parsed by
 * Safari before 16.4 and cannot be lowered by the client build, and this
 * package ships to the browser as source.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const LOOKBEHIND = ["(?<" + "=", "(?<" + "!"];

test("no source file in @shelf/links uses regex lookbehind", () => {
  const dir = import.meta.dirname;
  const files = readdirSync(dir).filter((name) => name.endsWith(".ts"));
  assert.ok(files.includes("parse.ts"), "scans the package sources");
  for (const name of files) {
    const source = readFileSync(join(dir, name), "utf8");
    for (const needle of LOOKBEHIND) {
      assert.ok(!source.includes(needle), `${name} contains ${needle}`);
    }
  }
});
