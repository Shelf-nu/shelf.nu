/**
 * Guards on the /pr-review skill and agent files: the read-only tool lists,
 * the model choice, and the no-em-dash rule. A loosened tool list would let an
 * agent that reads untrusted PR text run commands or reach the network.
 *
 * @see ../../.claude/skills/pr-review/SKILL.md
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const AGENTS = [
  "shelf-pr-finding-validator",
  "shelf-pr-reviewer-tests",
  "shelf-pr-reviewer-conventions",
  "shelf-pr-reviewer-impact",
];

/** Returns the frontmatter of a Markdown file as a flat key/value map. */
function frontmatter(file) {
  const text = readFileSync(path.join(ROOT, file), "utf8");
  const block = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
  return Object.fromEntries(
    block
      .split("\n")
      .map((line) => line.match(/^(\w+):\s*(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim()])
  );
}

for (const name of AGENTS) {
  const file = `.claude/agents/${name}.md`;
  test(`${name}: exists, read-only tools, sonnet`, () => {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} missing`);
    const meta = frontmatter(file);
    assert.equal(meta.name, name);
    assert.equal(meta.tools, "Read, Grep, Glob");
    assert.equal(meta.model, "sonnet");
    assert.ok(
      meta.description.length > 40,
      "description explains when to use it"
    );
  });
}

test("no em or en dashes in the skill, agents, or docs", () => {
  const files = [
    ...AGENTS.map((name) => `.claude/agents/${name}.md`),
    ".claude/skills/pr-review/SKILL.md",
    "apps/docs/pr-review.md",
    "scripts/pr-review-context.mjs",
  ].filter((file) => existsSync(path.join(ROOT, file)));
  for (const file of files) {
    assert.doesNotMatch(
      readFileSync(path.join(ROOT, file), "utf8"),
      /[\u2013\u2014]/,
      file
    );
  }
});

test("pr-review skill: name, and every agent it dispatches exists", () => {
  const file = ".claude/skills/pr-review/SKILL.md";
  assert.ok(existsSync(path.join(ROOT, file)), `${file} missing`);
  assert.equal(frontmatter(file).name, "pr-review");
  const text = readFileSync(path.join(ROOT, file), "utf8");
  for (const name of [...AGENTS, "shelf-security-reviewer"]) {
    assert.ok(text.includes(name), `SKILL.md dispatches ${name}`);
    assert.ok(
      existsSync(path.join(ROOT, `.claude/agents/${name}.md`)),
      `${name} agent file exists`
    );
  }
  assert.ok(
    text.includes("scripts/pr-review-context.mjs"),
    "SKILL.md runs the context script"
  );
});
