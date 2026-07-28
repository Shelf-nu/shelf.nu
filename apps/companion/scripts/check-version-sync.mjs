/**
 * Asserts the app version agrees across every file that declares it.
 *
 * With `runtimeVersion: { policy: "appVersion" }`, the version string IS the
 * OTA compatibility key: an `eas update` only reaches builds whose runtime
 * version matches. The version lives in FIVE places (app.json, Info.plist,
 * two MARKETING_VERSION build configs in project.pbxproj, and Expo.plist's
 * EXUpdatesRuntimeVersion) and drifts on the first hurried release bump —
 * at which point updates silently stop reaching some or all installs.
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

/** Collect every declared version as {source: version}. */
const found = {};

found["app.json (expo.version)"] = JSON.parse(read("app.json")).expo.version;

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

const versions = Object.values(found);
const distinct = [...new Set(versions)];

if (versions.some((v) => !v)) {
  console.error("[version-sync] FAILED — a version declaration went missing:");
  console.error(found);
  process.exit(1);
}

if (distinct.length > 1) {
  console.error(
    "[version-sync] FAILED — version drift across declarations. With the " +
      "appVersion runtime policy this silently breaks OTA update targeting:"
  );
  for (const [source, version] of Object.entries(found)) {
    console.error(`  ${version}  ${source}`);
  }
  process.exit(1);
}

console.log(
  `[version-sync] OK — ${versions.length} declarations agree on ${distinct[0]}`
);
