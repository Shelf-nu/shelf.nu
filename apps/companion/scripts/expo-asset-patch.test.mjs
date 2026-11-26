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

test("fromMetadata remembers the fallback name on the asset", () => {
  assert.match(
    assetSource,
    /asset\._embeddedResourceUriFromBundle = embeddedResourceUriFromMetadata\(asset\.uri, meta\)/
  );
});

/**
 * The installed `Asset.prototype.downloadAsync`, run against a controlled downloader.
 *
 * `Asset.js` imports React Native, so it cannot be imported here. The method is the last
 * member of the class, so its source is cut out and evaluated on a bare object.
 *
 * @param downloader - Stands in for the native `ExpoAsset.downloadAsync`
 * @param fallbackUri - What `fromMetadata` stored, or null when there is no other name
 * @returns The asset-like object and the list of URIs the downloader was asked for
 */
function makeAsset(downloader, fallbackUri) {
  const match = assetSource.match(
    /async downloadAsync\(\) \{[\s\S]*?\n {4}\}\n\}\s*\n\/\/# sourceMappingURL/
  );
  assert.ok(match, "could not find Asset.downloadAsync in the installed file");
  const methodSource = match[0].replace(/\n\}\s*\n\/\/# sourceMappingURL$/, "");
  const asked = [];
  const method = new Function(
    "downloadAsync",
    "Platform",
    "ImageAssets",
    "AssetUris",
    `return (${methodSource.replace(
      "async downloadAsync()",
      "async function()"
    )});`
  )(
    (uri, hash, type) => {
      asked.push(uri);
      return downloader(uri, hash, type);
    },
    { OS: "android" },
    {},
    {}
  );
  const asset = {
    uri: storedFromOldBuild,
    hash: "hash",
    type: "ttf",
    localUri: null,
    downloaded: false,
    downloading: false,
    _downloadCallbacks: [],
    _embeddedResourceUriFromBundle: fallbackUri,
    downloadAsync: method,
  };
  return { asset, asked };
}

const missing = () => Promise.reject(new Error("Unable to download asset"));

test("downloadAsync uses the stored location when it loads, and asks for nothing else", async () => {
  const { asset, asked } = makeAsset(
    () => Promise.resolve("file:///cache/a.ttf"),
    nameInThisBuild
  );
  await asset.downloadAsync();
  assert.deepEqual(asked, [storedFromOldBuild]);
  assert.equal(asset.localUri, "file:///cache/a.ttf");
  assert.equal(asset.uri, storedFromOldBuild);
  assert.equal(asset.downloaded, true);
});

test("downloadAsync loads the file under this build's name when the stored one is gone", async () => {
  const { asset, asked } = makeAsset(
    (uri) =>
      uri === nameInThisBuild
        ? Promise.resolve("file:///cache/a.ttf")
        : missing(),
    nameInThisBuild
  );
  await asset.downloadAsync();
  assert.deepEqual(asked, [storedFromOldBuild, nameInThisBuild]);
  assert.equal(asset.localUri, "file:///cache/a.ttf");
  assert.equal(asset.uri, nameInThisBuild);
  assert.equal(asset.downloaded, true);
});

test("downloadAsync rejects with the retry's error when both names are gone", async () => {
  const { asset, asked } = makeAsset(
    (uri) => Promise.reject(new Error(`missing ${uri}`)),
    nameInThisBuild
  );
  await assert.rejects(asset.downloadAsync(), {
    message: `missing ${nameInThisBuild}`,
  });
  assert.deepEqual(asked, [storedFromOldBuild, nameInThisBuild]);
  assert.equal(asset.downloaded, false);
  assert.equal(asset.downloading, false);
});

test("the stored name's error travels with the retry's error as its cause", async () => {
  const { asset } = makeAsset(
    (uri) => Promise.reject(new Error(`missing ${uri}`)),
    nameInThisBuild
  );
  const error = await asset.downloadAsync().catch((caught) => caught);
  assert.equal(error.message, `missing ${nameInThisBuild}`);
  assert.equal(error.cause?.message, `missing ${storedFromOldBuild}`);
});

test("a second caller is rejected too when both names are gone", async () => {
  const { asset } = makeAsset(missing, nameInThisBuild);
  const first = asset.downloadAsync();
  const second = asset.downloadAsync();
  await assert.rejects(first);
  await assert.rejects(second);
  assert.equal(asset.downloading, false);
});

test("downloadAsync rethrows the original error when there is no other name", async () => {
  const { asset, asked } = makeAsset(missing, null);
  await assert.rejects(asset.downloadAsync(), {
    message: "Unable to download asset",
  });
  assert.deepEqual(asked, [storedFromOldBuild]);
  assert.equal(asset.downloaded, false);
});

test("a second caller settles only after the retry has finished", async () => {
  let releaseRetry;
  const retryGate = new Promise((resolve) => {
    releaseRetry = resolve;
  });
  const { asset } = makeAsset(
    (uri) =>
      uri === nameInThisBuild
        ? retryGate.then(() => "file:///cache/a.ttf")
        : missing(),
    nameInThisBuild
  );
  const first = asset.downloadAsync();
  let secondSettled = false;
  const second = asset.downloadAsync().then(() => {
    secondSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    secondSettled,
    false,
    "the waiting caller must not settle before the retry"
  );
  releaseRetry();
  await Promise.all([first, second]);
  assert.equal(secondSettled, true);
  assert.equal(asset.localUri, "file:///cache/a.ttf");
});

/**
 * React Native's own resource naming, read from the installed package.
 *
 * `@react-native/asset-utils` does not export the file and it carries Flow syntax, so the two
 * functions are cut from its source (their annotations are comments) and evaluated.
 */
function loadReactNativeNaming() {
  const reactNative = createRequire(
    require.resolve("react-native/package.json")
  );
  const source = readFileSync(
    join(
      dirname(reactNative.resolve("@react-native/asset-utils/package.json")),
      "src/AndroidPathUtils.js"
    ),
    "utf8"
  );
  const identifier = source.match(
    /function getAndroidResourceIdentifier\([\s\S]*?\n}/
  );
  const basePath = source.match(/function getBasePath\([\s\S]*?\n}/);
  assert.ok(
    identifier && basePath,
    "React Native's naming functions were not found"
  );
  return new Function(
    `${basePath[0]}\n${identifier[0]}\nreturn getAndroidResourceIdentifier;`
  )();
}

test("the fallback name is the name React Native gives the file", () => {
  const helper = loadHelper();
  const reactNativeIdentifier = loadReactNativeNaming();
  const cases = [
    metaInThisBuild,
    {
      name: "back-icon",
      type: "png",
      httpServerLocation: "/assets/../../node_modules/pkg/lib/assets",
    },
    {
      name: "Logo @2x v1.2",
      type: "png",
      httpServerLocation: "/assets/assets/images",
    },
    {
      name: "bleep",
      type: "wav",
      httpServerLocation: "/assets/?unstable_path=.%2Fassets%2Fsounds",
    },
    { name: "Ünïcode Näme", type: "ttf", httpServerLocation: "assets/fonts" },
  ];
  for (const meta of cases) {
    const stored = `${BASE}raw/some_older_name.${meta.type}`;
    assert.equal(
      helper(stored, meta),
      `${BASE}raw/${reactNativeIdentifier(meta)}.${meta.type}`,
      `differs from React Native for ${meta.httpServerLocation}/${meta.name}`
    );
  }
});
