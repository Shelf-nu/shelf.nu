/**
 * Asserts the exported bundles carry the environment they are meant to: the
 * expected Supabase project, and React Native's fetch as the global fetch
 * (see metro.config.js for why the app needs it).
 *
 * It also asserts two things the Android bundle needs to load its embedded
 * fonts on a phone that was upgraded from an older store build: the patched
 * expo-asset is in the bundle, and the icon font sits in the same
 * `node_modules/.pnpm` folder as in the store build the bundle is published
 * to. See {@link hasEmbeddedAssetFallback} and {@link iconFontFoldersIn}.
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

/**
 * Name of Expo's native fetch module. Expo's fetch is compiled into a bundle
 * only when it is installed as the global fetch; with EXPO_PUBLIC_USE_RN_FETCH
 * set (see metro.config.js) the minifier drops it, name included.
 */
const EXPO_FETCH_MARKER = "ExpoFetchModule";

/**
 * Whether a bundle installs Expo's fetch as the global fetch instead of
 * React Native's.
 *
 * @param text - bundle contents, read as binary-safe latin1
 * @returns true when Expo's fetch is in the bundle
 */
export function usesExpoFetch(text) {
  return text.includes(EXPO_FETCH_MARKER);
}

/**
 * Property the patched expo-asset sets on an asset
 * (`patches/expo-asset@58.0.19.patch`). A bundle exported from a tree where the
 * patch is not installed does not contain it.
 */
const EMBEDDED_ASSET_FALLBACK_MARKER = "_embeddedResourceUriFromBundle";

/**
 * Whether a bundle carries the expo-asset patch that retries an embedded asset
 * under this bundle's own resource name.
 *
 * @param text - bundle contents, read as binary-safe latin1
 * @returns true when the patched `Asset` is in the bundle
 */
export function hasEmbeddedAssetFallback(text) {
  return text.includes(EMBEDDED_ASSET_FALLBACK_MARKER);
}

/**
 * The `node_modules/.pnpm` folder of `@expo/vector-icons` inside each live
 * store build, by runtime version.
 *
 * An Android store build packages the icon font as a resource whose file name
 * is derived from this folder. The expo-asset patch finds the font on an
 * upgraded phone by building that same name from the bundle's metadata, so an
 * update only works there while its folder equals the store build's. The
 * trailing hash covers the package's whole peer set, so an unrelated dependency
 * bump can move it.
 *
 * Add an entry when a store build is cut: read `subdirectory` of the Ionicons
 * asset in the build's `assets/app.manifest`.
 */
export const STORE_BUILD_ICON_FONT_FOLDERS = {
  "1.8.0":
    "@expo+vector-icons@15.1.1_expo-font@58.0.11_expo@58.0.22_react-native@0.88.1_@babel+core@7.29_yxvw2n2zge5t45o6qgogiuuuqu",
};

/**
 * A `node_modules/.pnpm` folder of `@expo/vector-icons` as it appears in an
 * asset path. Anchored on the fixed path that follows the folder, because
 * Hermes packs strings with no separators.
 */
const ICON_FONT_FOLDER_RE =
  /@expo\+vector-icons@[A-Za-z0-9@._+=-]+(?=\/node_modules\/@expo\/vector-icons\/)/g;

/**
 * Every distinct `node_modules/.pnpm` folder the bundle loads
 * `@expo/vector-icons` assets from.
 *
 * @param text - bundle contents, read as binary-safe latin1
 * @returns the distinct folder names found, sorted
 */
export function iconFontFoldersIn(text) {
  const folders = new Set();
  for (const match of text.matchAll(ICON_FONT_FOLDER_RE)) folders.add(match[0]);
  return [...folders].sort();
}

/**
 * What is wrong with an Android bundle's embedded-asset handling, if anything.
 *
 * @param text - bundle contents, read as binary-safe latin1
 * @param runtimeVersion - the runtime the bundle is published to
 * @returns one message per problem; empty when the bundle is fine
 */
export function embeddedAssetProblems(text, runtimeVersion) {
  const problems = [];
  if (!hasEmbeddedAssetFallback(text)) {
    problems.push("expo-asset patch missing (run pnpm install, export again)");
  }
  const expected = STORE_BUILD_ICON_FONT_FOLDERS[runtimeVersion];
  if (!expected) {
    problems.push(
      `no icon font folder recorded for runtime ${runtimeVersion} (STORE_BUILD_ICON_FONT_FOLDERS)`
    );
    return problems;
  }
  const folders = iconFontFoldersIn(text);
  if (folders.length !== 1 || folders[0] !== expected) {
    problems.push(
      `icon font folder differs from the ${runtimeVersion} store build: ${
        folders.join(" ") || "(none found)"
      }`
    );
  }
  return problems;
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

  const runtimeVersion = JSON.parse(readFileSync("app.json", "utf8")).expo
    .runtimeVersion;
  let bad = false;
  for (const path of paths) {
    const text = readFileSync(path, "latin1");
    const refs = refsIn(text);
    const refOk = refs.length === 1 && refs[0] === expected;
    const fetchOk = !usesExpoFetch(text);
    // Embedded resource names are an Android matter: see STORE_BUILD_ICON_FONT_FOLDERS.
    const assetProblems = path.includes(`${join(DIST, "android")}`)
      ? embeddedAssetProblems(text, runtimeVersion)
      : [];
    const ok = refOk && fetchOk && assetProblems.length === 0;
    console.log(
      `  ${ok ? "ok  " : "FAIL"} ${path}  ->  ${
        refs.join(" ") || "(no Supabase ref found)"
      }${fetchOk ? "" : "  + Expo fetch is the global fetch"}${assetProblems
        .map((problem) => `\n         ${problem}`)
        .join("")}`
    );
    if (!ok) bad = true;
  }

  if (bad) {
    console.error(
      `\n[bundle-env] FAILED: expected exactly ${expected}, React Native's fetch, the\n` +
        "  expo-asset patch and the store build's icon font folder in the Android bundle.\n" +
        "  Do NOT publish. Run pnpm install, re-export with --clear from apps/companion (so\n" +
        "  metro.config.js sets EXPO_PUBLIC_USE_RN_FETCH) and run this again. If the icon font\n" +
        "  folder moved, a dependency changed since the store build: see EAS-UPDATE.md."
    );
    process.exit(1);
  }
  console.log(
    `\n[bundle-env] OK: every bundle points at ${expected} and uses React Native's fetch;\n` +
      "  the Android bundle has the expo-asset patch and the store build's icon font folder"
  );
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
