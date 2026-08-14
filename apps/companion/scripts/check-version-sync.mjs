/**
 * Asserts the app version agrees across every file that declares it.
 *
 * The runtime version IS the OTA compatibility key: an `eas update` only
 * reaches builds whose runtime version matches. Because iOS is the generic
 * (bare) workflow, that version is a hand-written literal rather than a
 * policy, so nothing derives it for us. It lives in SIX places (app.json
 * `version` and `runtimeVersion`, Info.plist, two MARKETING_VERSION build
 * configs in project.pbxproj, and Expo.plist's EXUpdatesRuntimeVersion) and
 * drifts on the first hurried release bump, at which point updates silently
 * stop reaching some or all installs.
 *
 * Runs as part of `pnpm --filter @shelf/companion lint` (so CI's lint job
 * catches drift on every PR). Zero dependencies; exits 1 on mismatch.
 *
 * @see {@link file://../EAS-UPDATE.md} the OTA runbook (release checklist)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

/**
 * How many declarations must be found. A regex that silently matches nothing
 * (a restructured plist, a renamed build config) would otherwise leave the
 * survivors trivially "in agreement" and report a false pass, disabling the
 * guard in exactly the release where a file moved.
 */
const EXPECTED_DECLARATIONS = 6;
/** Both the Debug and Release build configs carry a MARKETING_VERSION. */
const EXPECTED_MARKETING_VERSIONS = 2;

/** Collect every declared version as {source: version}. */
const found = {};

const appJson = JSON.parse(read("app.json")).expo;
found["app.json (expo.version)"] = appJson.version;

/**
 * iOS is the GENERIC (bare) workflow because ios/ is committed, and
 * expo-updates refuses `runtimeVersion: { policy: "appVersion" }` there:
 * `expo-updates runtimeversion:resolve --platform ios` exits non-zero, which
 * fails both `eas update` and `eas build`. So the runtime version is a hand
 * written literal, which makes it the declaration most likely to be forgotten
 * on a release bump. If it drifts, updates silently stop matching installs.
 */
found["app.json (expo.runtimeVersion)"] =
  typeof appJson.runtimeVersion === "string" ? appJson.runtimeVersion : null;

const infoPlist = read("ios/Shelf/Info.plist");
found["Info.plist (CFBundleShortVersionString)"] = infoPlist.match(
  /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/
)?.[1];

const expoPlist = read("ios/Shelf/Supporting/Expo.plist");
found["Expo.plist (EXUpdatesRuntimeVersion)"] = expoPlist.match(
  /<key>EXUpdatesRuntimeVersion<\/key>\s*<string>([^<]+)<\/string>/
)?.[1];

const pbxproj = read("ios/Shelf.xcodeproj/project.pbxproj");
const marketing = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(
  (m) => m[1].trim()
);
marketing.forEach((v, i) => {
  found[`project.pbxproj (MARKETING_VERSION #${i + 1})`] = v;
});

if (marketing.length !== EXPECTED_MARKETING_VERSIONS) {
  console.error(
    `[version-sync] FAILED — expected ${EXPECTED_MARKETING_VERSIONS} ` +
      `MARKETING_VERSION declarations in project.pbxproj, found ` +
      `${marketing.length}. The build configs changed, or the pattern no ` +
      `longer matches; fix this script before trusting the check.`
  );
  process.exit(1);
}

const versions = Object.values(found);
const distinct = [...new Set(versions)];

if (versions.some((v) => !v) || versions.length !== EXPECTED_DECLARATIONS) {
  console.error(
    `[version-sync] FAILED — expected ${EXPECTED_DECLARATIONS} version ` +
      `declarations, resolved ${versions.filter(Boolean).length}. A file was ` +
      `moved or a pattern stopped matching:`
  );
  console.error(found);
  process.exit(1);
}

if (distinct.length > 1) {
  console.error(
    "[version-sync] FAILED — version drift across declarations. The runtime " +
      "version is the OTA compatibility key, so drift silently stops updates " +
      "reaching installs:"
  );
  for (const [source, version] of Object.entries(found)) {
    console.error(`  ${version}  ${source}`);
  }
  process.exit(1);
}

console.log(
  `[version-sync] OK — ${versions.length} declarations agree on ${distinct[0]}`
);
