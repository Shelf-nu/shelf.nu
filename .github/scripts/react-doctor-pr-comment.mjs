/**
 * react-doctor PR comment builder.
 *
 * Reads the diagnostics JSON written by `pnpm exec react-doctor . --diff`,
 * filters out the knip dead-code findings (out of scope for PR review),
 * and prints a Markdown comment body to stdout.
 *
 * Invoked from `.github/workflows/react-doctor.yml` after the doctor scan.
 *
 * Usage:
 *   node .github/scripts/react-doctor-pr-comment.mjs <diagnostics-dir>
 */

import fs from "node:fs";
import path from "node:path";

const HEADER = "## 🩺 React Doctor";
const FOOTER =
  "<sub>Run locally with `pnpm webapp:doctor` for a full scan, or " +
  "`cd apps/webapp && pnpm exec react-doctor . --diff` for the same " +
  "diff-only view.</sub>";

const diagDir = process.argv[2];

if (!diagDir) {
  console.log(
    `${HEADER}\n\nNo diagnostics directory passed — scan may have failed. ` +
      `Check the workflow logs.\n`
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
    : `apps/webapp/${d.filePath}`;
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
