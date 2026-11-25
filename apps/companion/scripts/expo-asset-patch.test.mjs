/**
 * Pins the expo-asset patch (`patches/expo-asset@58.0.19.patch`).
 *
 * On Android, expo-updates stores an embedded asset's location by content hash. After a store
 * upgrade the stored `file:///android_res/...` location can still name the previous build's
 * resource file, and `Asset.downloadAsync` then fails for an asset whose content did not change
 * (the icon font). The patch makes `downloadAsync` fall back to the name this bundle's own
 * metadata gives the file. These tests read the installed, patched file, so they fail if the
 * patch stops applying (for example after an expo-asset upgrade).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

const require = createRequire(import.meta.url);
const assetSource = readFileSync(
  join(dirname(require.resolve("expo-asset/package.json")), "build/Asset.js"),
  "utf8"
);

const BASE = "file:///android_res/";

/** The patched helper, evaluated from the installed source. */
function loadHelper() {
  const match = assetSource.match(
    /export function embeddedResourceUriFromMetadata[\s\S]*?\n}/
  );
  assert.ok(match, "expo-asset is not patched: helper is missing");
  return new Function(
    "ANDROID_EMBEDDED_URL_BASE_RESOURCE",
    `${match[0].replace(
      "export ",
      ""
    )}; return embeddedResourceUriFromMetadata;`
  )(BASE);
}

const FONT_DIR =
  "node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts";
const NEW_BUILD =
  "@expo+vector-icons@15.1.1_expo-font@58.0.11_expo@58.0.22_react-native@0.88.1_@babel+core@7.29_bbbb";

const storedFromOldBuild = `${BASE}raw/__node_modules_pnpm_expovectoricons1511_expofont14011_expo54033_reactnative0815_babelcore729_aaaa_node_modules_expo_vectoricons_build_vendor_reactnativevectoricons_fonts_ionicons.ttf`;
const nameInThisBuild = `${BASE}raw/__node_modules_pnpm_expovectoricons1511_expofont58011_expo58022_reactnative0881_babelcore729_bbbb_node_modules_expo_vectoricons_build_vendor_reactnativevectoricons_fonts_ionicons.ttf`;
const metaInThisBuild = {
  name: "Ionicons",
  type: "ttf",
  httpServerLocation: `/assets/__node_modules/.pnpm/${NEW_BUILD}/${FONT_DIR}`,
};

test("names the file the way this build packaged it when the stored name is from an older build", () => {
  const helper = loadHelper();
  assert.equal(helper(storedFromOldBuild, metaInThisBuild), nameInThisBuild);
});

test("gives no fallback when the stored name is already this build's name", () => {
  const helper = loadHelper();
  assert.equal(helper(nameInThisBuild, metaInThisBuild), null);
});

test("keeps the resource folder of a drawable", () => {
  const helper = loadHelper();
  const stored = `${BASE}drawable-xhdpi/__node_modules_pnpm_old_node_modules_pkg_assets_backicon.png`;
  const meta = {
    name: "back-icon",
    type: "png",
    httpServerLocation:
      "/assets/__node_modules/.pnpm/new/node_modules/pkg/assets",
  };
  assert.equal(
    helper(stored, meta),
    `${BASE}drawable-xhdpi/__node_modules_pnpm_new_node_modules_pkg_assets_backicon.png`
  );
});

test("gives no fallback for a location that is not an embedded resource, or without metadata", () => {
  const helper = loadHelper();
  assert.equal(
    helper("file:///data/user/0/app/files/x.ttf", metaInThisBuild),
    null
  );
  assert.equal(helper("https://example.com/x.ttf", metaInThisBuild), null);
  assert.equal(helper(storedFromOldBuild, undefined), null);
  assert.equal(helper(storedFromOldBuild, { name: "Ionicons" }), null);
  assert.equal(helper(undefined, metaInThisBuild), null);
});

test("downloadAsync retries with the fallback name and only then rethrows", () => {
  assert.match(
    assetSource,
    /asset\._embeddedResourceUriFromBundle = embeddedResourceUriFromMetadata\(asset\.uri, meta\)/,
    "fromMetadata must remember the fallback name"
  );
  const retry = assetSource.match(
    /catch \(error\) \{[\s\S]*?const fallbackUri = this\._embeddedResourceUriFromBundle;[\s\S]*?if \(!fallbackUri\) \{\s*throw error;\s*\}[\s\S]*?downloadAsync\(fallbackUri, this\.hash, this\.type\)/
  );
  assert.ok(
    retry,
    "downloadAsync must fall back, and rethrow when there is no fallback"
  );
});
