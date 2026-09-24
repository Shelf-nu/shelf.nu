/**
 * Asserts the exported bundles carry the environment they are meant to.
 *
 * `EXPO_PUBLIC_*` values are inlined by Metro at export time, and Metro's
 * transform cache is keyed on file content rather than on the environment. A
 * cached module therefore keeps whatever was inlined when it was cached, so an
 * export can silently reproduce an earlier environment and still report
 * success. This reads the values back out of the built artifact instead of
 * trusting the exporter.
 *
 * Matching is done on the project ref between `https://` and `.supabase.co`,
 * not by parsing URLs. Hermes packs every string literal into one contiguous
 * blob with no separators, so a URL runs straight into whatever string follows
 * it and `new URL()` reads a hostname that was never in the source. The ref is
 * delimited on both sides by fixed text, which survives that packing.
 *
 * Run it under the same environment the export claimed, so the expected values
 * arrive the same way the baked ones did:
 *
 *   eas env:exec production "node scripts/check-bundle-env.mjs"
 *
 * Exits non-zero on any mismatch, so it can gate a publish.
 *
 * @see {@link file://../EAS-UPDATE.md} the release runbook that calls this
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Where `expo export` writes the platform bundles. */
const DIST = "dist/_expo/static/js";

/**
 * A Supabase project ref as it appears inside a bundle.
 *
 * The ref is the label before `.supabase.co`. Both delimiters are literal, so
 * this stays anchored even though the surrounding bytes are other packed
 * strings rather than whitespace.
 */
const REF_RE = /https:\/\/([a-z0-9]{8,})\.supabase\.co/g;

/**
 * Every distinct Supabase project ref appearing in `text`.
 *
 * @param text - bundle contents, read as binary-safe latin1
 * @returns the distinct refs found, sorted
 */
export function refsIn(text) {
  const refs = new Set();
  for (const match of text.matchAll(REF_RE)) refs.add(match[1]);
  return [...refs].sort();
}

/** Every built bundle under {@link DIST}, per platform. */
function bundlePaths() {
  const out = [];
  for (const platform of readdirSync(DIST)) {
    const dir = join(DIST, platform);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".hbc") || file.endsWith(".js"))
        out.push(join(dir, file));
    }
  }
  return out;
}

function main() {
  const expectedUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!expectedUrl) {
    console.error(
      "[bundle-env] FAILED — EXPO_PUBLIC_SUPABASE_URL is not set.\n" +
        '  Run under the target environment: eas env:exec production "node scripts/check-bundle-env.mjs"'
    );
    process.exit(1);
  }

  const expected = expectedUrl.match(
    /https:\/\/([a-z0-9]+)\.supabase\.co/
  )?.[1];
  if (!expected) {
    console.error(
      `[bundle-env] FAILED — EXPO_PUBLIC_SUPABASE_URL is not a Supabase URL: ${expectedUrl}`
    );
    process.exit(1);
  }

  let paths = [];
  try {
    paths = bundlePaths();
  } catch {
    /* handled by the emptiness check below */
  }
  if (paths.length === 0) {
    console.error(
      `[bundle-env] FAILED — no bundles under ${DIST}. Run the export first.`
    );
    process.exit(1);
  }

  let bad = false;
  for (const path of paths) {
    const refs = refsIn(readFileSync(path, "latin1"));
    const ok = refs.length === 1 && refs[0] === expected;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${path}  ->  ${
        refs.join(" ") || "(no Supabase ref found)"
      }`
    );
    if (!ok) bad = true;
  }

  if (bad) {
    console.error(
      `\n[bundle-env] FAILED — expected exactly ${expected}.\n` +
        "  Do NOT publish. Re-export with --clear and run this again."
    );
    process.exit(1);
  }
  console.log(`\n[bundle-env] OK — every bundle points at ${expected}`);
}

// `process.argv[1]` is whatever path the caller typed, so it is relative when
// invoked as `node scripts/check-bundle-env.mjs`. Resolve it to a file URL
// before comparing, or the guard never matches and this gate passes silently.
// It is absent entirely under `node -e`, where importing this module must not
// run the gate.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
