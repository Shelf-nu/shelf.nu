// Learn more https://docs.expo.dev/guides/monorepos/

// The app talks to the server through React Native's fetch (whatwg-fetch over
// XMLHttpRequest), not Expo's native fetch. Expo installs its own fetch as the
// global one unless EXPO_PUBLIC_USE_RN_FETCH is set when the bundle is built,
// and the app depends on React Native's behaviour: multipart parts given as
// `{ uri, type, name }`, AbortError and TypeError on cancel and network
// failure, and a promise that resolves only after the whole body has arrived,
// so one timer covers the full request.
//
// It is set here rather than in an EAS environment because this file is loaded
// by every path that bundles the app (dev server, `expo export`, the embedded
// bundle of an EAS build), before Metro starts the workers that read it.
// `scripts/check-bundle-env.mjs` fails an export that was built without it.
// See https://github.com/expo/expo/issues/46982 for why the variable reaches
// code inside node_modules.
process.env.EXPO_PUBLIC_USE_RN_FETCH = "1";

const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// Explicitly set the project root so Metro resolves the entry point
// (package.json "main") from apps/companion/ — not the monorepo root.
config.projectRoot = projectRoot;

// 1. Watch all files in the monorepo
config.watchFolders = [monorepoRoot];

// 2. Prevent Metro from resolving packages outside the companion app's own
// node_modules first. In a pnpm monorepo with shamefully-hoist=true,
// without this Metro can pick up incompatible versions of shared packages
// (e.g. different patch versions of React) from the hoisted root.
config.resolver.disableHierarchicalLookup = true;

// 3. Explicit resolution order: companion's node_modules first, then monorepo root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// 4. Metro's transform cache is keyed on file content, not on the environment,
// so a module transformed before the fetch switch was set would keep Expo's
// fetch. Naming the switch in the cache version makes Metro discard those.
config.cacheVersion = `${config.cacheVersion ?? ""}|rn-fetch:${
  process.env.EXPO_PUBLIC_USE_RN_FETCH
}`;

module.exports = config;
