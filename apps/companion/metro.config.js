// Learn more https://docs.expo.dev/guides/monorepos/
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

module.exports = config;
