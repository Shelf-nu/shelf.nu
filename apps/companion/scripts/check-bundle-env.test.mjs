/**
 * Tests for the export gate and the Metro setting it guards.
 *
 * The app needs React Native's fetch as the global fetch. metro.config.js
 * turns Expo's fetch off for every bundle, and check-bundle-env.mjs refuses an
 * exported bundle that still carries it.
 *
 * The gate also refuses an Android bundle that lacks the expo-asset patch or
 * loads the icon font from another folder than the store build it updates.
 *
 * @see {@link file://./check-bundle-env.mjs}
 * @see {@link file://../metro.config.js}
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

import {
  STORE_BUILD_ICON_FONT_FOLDERS,
  assetProblemsFor,
  embeddedAssetProblems,
  hasAndroidBundle,
  hasEmbeddedAssetFallback,
  iconFontFoldersIn,
  refsIn,
  usesExpoFetch,
} from "./check-bundle-env.mjs";

const require = createRequire(import.meta.url);

describe("usesExpoFetch", () => {
  it("flags a bundle that carries Expo's native fetch module", () => {
    assert.equal(
      usesExpoFetch("\u0000requireNativeModule\u0000ExpoFetchModule\u0000"),
      true
    );
  });

  it("passes a bundle that uses React Native's fetch", () => {
    assert.equal(
      usesExpoFetch("\u0000Network request failed\u0000expo.builtin\u0000"),
      false
    );
  });
});

describe("refsIn", () => {
  it("still reads the Supabase ref out of packed Hermes strings", () => {
    assert.deepEqual(refsIn("xhttps://abcdefghijkl.supabase.coNext string"), [
      "abcdefghijkl",
    ]);
  });
});

/** A packed asset path as Hermes stores it, with no separator after it. */
function fontPath(folder) {
  return `/assets/__node_modules/.pnpm/${folder}/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/FontsIonicons`;
}

describe("embedded assets in the Android bundle", () => {
  const storeFolder = STORE_BUILD_ICON_FONT_FOLDERS["1.8.0"];
  const patched = "\u0000_embeddedResourceUriFromBundle\u0000";

  it("passes a patched bundle whose icon font folder is the store build's", () => {
    assert.deepEqual(
      embeddedAssetProblems(`${patched}${fontPath(storeFolder)}`, "1.8.0"),
      []
    );
  });

  it("refuses a bundle exported without the expo-asset patch", () => {
    assert.equal(hasEmbeddedAssetFallback(fontPath(storeFolder)), false);
    assert.match(
      embeddedAssetProblems(fontPath(storeFolder), "1.8.0").join("\n"),
      /expo-asset patch missing/
    );
  });

  it("refuses a bundle whose icon font folder moved since the store build", () => {
    const moved = storeFolder.replace(/_[a-z0-9]+$/, "_otherhash");
    assert.deepEqual(iconFontFoldersIn(fontPath(moved)), [moved]);
    assert.match(
      embeddedAssetProblems(`${patched}${fontPath(moved)}`, "1.8.0").join("\n"),
      /icon font folder differs from the 1\.8\.0 store build/
    );
  });

  it("refuses a runtime with no recorded store build folder", () => {
    assert.match(
      embeddedAssetProblems(`${patched}${fontPath(storeFolder)}`, "9.9.9").join(
        "\n"
      ),
      /no icon font folder recorded for runtime 9\.9\.9/
    );
  });

  it("checks a bundle under the Android export folder", () => {
    const unpatched = fontPath(storeFolder);
    assert.match(
      assetProblemsFor(
        "dist/_expo/static/js/android/entry-abc.hbc",
        unpatched,
        "1.8.0"
      ).join("\n"),
      /expo-asset patch missing/
    );
  });

  it("does not apply the Android checks to an iOS bundle", () => {
    assert.deepEqual(
      assetProblemsFor("dist/_expo/static/js/ios/entry-abc.hbc", "", "1.8.0"),
      []
    );
  });

  it("knows when an export holds no Android bundle", () => {
    const ios = "dist/_expo/static/js/ios/entry-abc.hbc";
    const android = "dist/_expo/static/js/android/entry-abc.hbc";
    assert.equal(hasAndroidBundle([ios]), false);
    assert.equal(hasAndroidBundle([]), false);
    assert.equal(hasAndroidBundle([ios, android]), true);
  });

  it("records a folder for the runtime in app.json", () => {
    const { runtimeVersion } = require("../app.json").expo;
    assert.ok(
      STORE_BUILD_ICON_FONT_FOLDERS[runtimeVersion],
      `add the ${runtimeVersion} store build's folder to STORE_BUILD_ICON_FONT_FOLDERS`
    );
  });
});

describe("metro.config.js", () => {
  it("builds every bundle with React Native's fetch", () => {
    delete process.env.EXPO_PUBLIC_USE_RN_FETCH;
    require("../metro.config.js");
    assert.equal(process.env.EXPO_PUBLIC_USE_RN_FETCH, "1");
  });

  it("names the fetch switch in Metro's cache version", () => {
    const config = require("../metro.config.js");
    assert.match(String(config.cacheVersion), /rn-fetch:1/);
  });
});
