#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: format only the file that was just edited.
 *
 * Claude Code passes hook input as a JSON document on stdin, never as
 * environment variables. This script reads that document, takes
 * `tool_input.file_path`, and runs the repo-pinned prettier on that single
 * path. It exits quietly when the path is missing, the file does not exist,
 * lies outside the repository, or prettier declines the file (unsupported
 * type or `.prettierignore`), so an edit never fails because of formatting.
 *
 * Wired from `.claude/settings.json` (`hooks.PostToolUse`, matcher
 * `Edit|Write|MultiEdit`).
 *
 * Verify by hand from the repo root:
 *   echo '{"tool_input":{"file_path":"README.md"}}' | node scripts/prettier-hook.mjs
 *   echo '{}' | node scripts/prettier-hook.mjs   # formats nothing
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Reads all of stdin synchronously; an empty or absent payload yields "". */
function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/** Extracts `tool_input.file_path` from the hook payload, or null. */
function getEditedFilePath(raw) {
  if (!raw.trim()) return null;
  try {
    const payload = JSON.parse(raw);
    const filePath = payload?.tool_input?.file_path;
    return typeof filePath === "string" && filePath.trim() ? filePath : null;
  } catch {
    return null;
  }
}

/**
 * Builds the prettier command. Prefers the workspace install so the version
 * is the one pinned in package.json; falls back to npx with that same pinned
 * version when dependencies are not installed.
 */
function prettierCommand() {
  const localBin = join(repoRoot, "node_modules", ".bin", "prettier");
  if (existsSync(localBin)) return [localBin, []];

  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const version = pkg.devDependencies?.prettier ?? pkg.dependencies?.prettier;
  const spec = version ? `prettier@${version}` : "prettier";
  return ["npx", ["--yes", spec]];
}

const filePath = getEditedFilePath(readStdin());
if (!filePath) process.exit(0);

const absolute = resolve(repoRoot, filePath);

// Only format files inside this repository. An absolute or traversal path in
// the payload (`/etc/hosts`, `../../.ssh/config`) must never reach prettier.
if (!absolute.startsWith(repoRoot + sep)) process.exit(0);
if (!existsSync(absolute) || !statSync(absolute).isFile()) process.exit(0);

const [bin, baseArgs] = prettierCommand();
spawnSync(bin, [...baseArgs, "--write", "--ignore-unknown", absolute], {
  cwd: repoRoot,
  stdio: ["ignore", "inherit", "inherit"],
});

// Formatting is best effort: never block the edit on a prettier failure.
process.exit(0);
