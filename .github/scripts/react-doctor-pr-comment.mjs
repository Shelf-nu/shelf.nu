/**
 * react-doctor PR comment builder.
 *
 * Reads the diagnostics JSON written by `pnpm exec react-doctor . --diff`,
 * filters out the knip dead-code findings (out of scope for PR review),
 * and prints a Markdown comment body to stdout.
 *
 * Invoked from `.github/workflows/react-doctor.yml` (once per app in the
 * matrix) after the doctor scan.
 *
 * Usage:
 *   node .github/scripts/react-doctor-pr-comment.mjs \
 *     <diagnostics-dir> <exit-code> [path-prefix]
 *
 * `<diagnostics-dir>` may be empty: react-doctor only writes a diagnostics
 * directory when it has findings to record. The exit code (captured from the
 * CLI via PIPESTATUS in the workflow) disambiguates:
 *   - empty dir + exit 0       → clean scan, no findings
 *   - empty dir + non-zero exit → the CLI itself failed
 *
 * `[path-prefix]` is the scanned app dir with a trailing slash (e.g.
 * `apps/companion/`). react-doctor emits file paths relative to the scanned
 * dir, so we prepend this to render repo-root-relative links. The app name and
 * convenience script (`<app>:doctor`) are derived from it. Defaults to the
 * webapp for backward compatibility.
 */

import fs from "node:fs";
import path from "node:path";

const diagDir = process.argv[2];
const exitCode = process.argv[3];
// Normalize to exactly one trailing slash so callers can pass either
// "apps/companion" or "apps/companion/" without breaking the rendered links
// (`${pathPrefix}${d.filePath}`) or the footer `cd` command.
const pathPrefix = `${(process.argv[4] || "apps/webapp").replace(/\/+$/, "")}/`;

/** App dir without a trailing slash, e.g. "apps/companion". */
const appDir = pathPrefix.replace(/\/+$/, "");
/** App name derived from the prefix, e.g. "apps/companion/" → "companion". */
const appName = appDir.replace(/^apps\//, "") || "webapp";
/** Root convenience script for a full local scan, e.g. "companion:doctor". */
const doctorCmd = `${appName}:doctor`;

const HEADER = `## 🩺 React Doctor — ${appName}`;
const FOOTER =
  `<sub>Run locally with \`pnpm ${doctorCmd}\` for a full scan, or ` +
  `\`cd ${appDir} && pnpm exec react-doctor . --diff\` for the same ` +
  "diff-only view.</sub>";

if (!diagDir) {
  if (exitCode === "0") {
    console.log(
      `${HEADER}\n\n✅ No new findings on the files changed by this PR.\n\n${FOOTER}\n`
    );
    process.exit(0);
  }
  console.log(
    `${HEADER}\n\nNo diagnostics directory passed — scan may have failed ` +
      `(CLI exit ${exitCode || "unknown"}). Check the workflow logs.\n`
  );
  process.exit(0);
}

const diagFile = path.join(diagDir, "diagnostics.json");

if (!fs.existsSync(diagFile)) {
  console.log(
    `${HEADER}\n\n✅ No new findings on the files changed by this PR.\n\n${FOOTER}\n`
  );
  process.exit(0);
}

/** @type {Array<{filePath: string, plugin: string, rule: string, severity: "error"|"warning", message?: string, line?: number, column?: number}>} */
const all = JSON.parse(fs.readFileSync(diagFile, "utf-8"));
const findings = all.filter((d) => d.plugin !== "knip");

const errors = findings.filter((d) => d.severity === "error");
const warnings = findings.filter((d) => d.severity === "warning");

if (errors.length === 0 && warnings.length === 0) {
  console.log(
    `${HEADER}\n\n✅ No new findings on the files changed by this PR.\n\n${FOOTER}\n`
  );
  process.exit(0);
}

const lines = [HEADER, ""];
lines.push("Findings on the files changed by this PR:");
lines.push("");
lines.push(
  `- **${errors.length}** error${errors.length === 1 ? "" : "s"}` +
    `${errors.length > 0 ? " — _blocks merge_" : ""}`
);
lines.push(
  `- **${warnings.length}** warning${
    warnings.length === 1 ? "" : "s"
  } — _advisory_`
);
lines.push("");

const formatLocation = (d) => {
  const file = d.filePath.startsWith("apps/")
    ? d.filePath
    : `${pathPrefix}${d.filePath}`;
  const lineSuffix = d.line ? `:${d.line}` : "";
  return `\`${file}${lineSuffix}\``;
};

if (errors.length > 0) {
  lines.push("### ❌ Errors");
  lines.push("");
  for (const d of errors) {
    lines.push(`- ${formatLocation(d)} — \`${d.plugin}/${d.rule}\``);
    if (d.message) lines.push(`  > ${d.message}`);
  }
  lines.push("");
}

if (warnings.length > 0) {
  /** @type {Map<string, typeof warnings>} */
  const byRule = new Map();
  for (const d of warnings) {
    const key = `${d.plugin}/${d.rule}`;
    if (!byRule.has(key)) byRule.set(key, []);
    byRule.get(key).push(d);
  }
  const sortedRules = [...byRule.entries()].sort(
    (a, b) => b[1].length - a[1].length
  );

  lines.push("<details>");
  lines.push(
    `<summary><b>⚠️ ${warnings.length} warnings</b> (click to expand)</summary>`
  );
  lines.push("");
  for (const [rule, items] of sortedRules) {
    lines.push(`- **\`${rule}\`** (${items.length})`);
    for (const d of items) lines.push(`  - ${formatLocation(d)}`);
  }
  lines.push("");
  lines.push("</details>");
  lines.push("");
}

lines.push("---");
lines.push("");
lines.push(FOOTER);

console.log(lines.join("\n"));
