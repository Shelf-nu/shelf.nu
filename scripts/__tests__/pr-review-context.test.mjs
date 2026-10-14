/**
 * Tests for scripts/pr-review-context.mjs, the setup step of the /pr-review skill.
 *
 * Run: pnpm test:tooling (or node --test scripts/__tests__/pr-review-context.test.mjs)
 *
 * @see ../pr-review-context.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  globToRegExp,
  matchesGlob,
  parseRuleFrontmatter,
  selectRules,
  selectClaudeMdFiles,
  classifyFile,
  summarizeAreas,
  countChangedLines,
  pickTier,
  pickPasses,
  summarizeChecks,
  collectContext,
  resolvePrNumber,
  ContextError,
} from "../pr-review-context.mjs";

test("globToRegExp: ** matches zero or more directories", () => {
  assert.ok(
    matchesGlob(
      "apps/webapp/app/modules/x.ts",
      "apps/webapp/app/modules/**/*.ts"
    )
  );
  assert.ok(
    matchesGlob(
      "apps/webapp/app/modules/a/b/x.ts",
      "apps/webapp/app/modules/**/*.ts"
    )
  );
  assert.ok(
    !matchesGlob(
      "apps/webapp/app/modules/x.tsx",
      "apps/webapp/app/modules/**/*.ts"
    )
  );
});

test("globToRegExp: trailing ** matches everything below", () => {
  assert.ok(
    matchesGlob(
      "apps/webapp/app/modules/booking/service.server.ts",
      "apps/webapp/app/modules/booking/**"
    )
  );
  assert.ok(
    !matchesGlob(
      "apps/webapp/app/modules/bookingx/a.ts",
      "apps/webapp/app/modules/booking/**"
    )
  );
});

test("globToRegExp: single * does not cross directories", () => {
  assert.ok(
    matchesGlob(
      "apps/webapp/app/routes/_layout+/bookings.$id.tsx",
      "apps/webapp/app/routes/**/*booking*"
    )
  );
  assert.ok(!matchesGlob("apps/webapp/app/a/b.ts", "apps/webapp/app/*.ts"));
});

test("globToRegExp: brace alternatives and literal dots", () => {
  assert.ok(
    matchesGlob("apps/webapp/app/x.tsx", "apps/webapp/app/**/*.{ts,tsx}")
  );
  assert.ok(
    matchesGlob("apps/webapp/app/x.ts", "apps/webapp/app/**/*.{ts,tsx}")
  );
  assert.ok(
    !matchesGlob("apps/webapp/app/x.js", "apps/webapp/app/**/*.{ts,tsx}")
  );
  assert.ok(!matchesGlob("pnpm-workspaceXyaml", "pnpm-workspace.yaml"));
  assert.ok(globToRegExp("routes/api+/x.ts").test("routes/api+/x.ts"));
});

test("parseRuleFrontmatter: description and block list paths", () => {
  const md = `---\ndescription: Org-scope ids\npaths:\n  - "apps/webapp/app/modules/**/*.ts"\n  - 'apps/webapp/app/routes/**'\n---\n\n# Body\n- not a path\n`;
  assert.deepEqual(parseRuleFrontmatter(md), {
    description: "Org-scope ids",
    paths: ["apps/webapp/app/modules/**/*.ts", "apps/webapp/app/routes/**"],
  });
});

test("parseRuleFrontmatter: no frontmatter means no paths", () => {
  assert.deepEqual(parseRuleFrontmatter("# Never Use Em Dashes\n"), {
    description: "",
    paths: [],
  });
});

test("selectRules: rules without paths always apply; others need a matching file", () => {
  const rules = [
    { path: "a.md", paths: [] },
    { path: "b.md", paths: ["apps/companion/**/*.tsx"] },
    { path: "c.md", paths: ["apps/webapp/app/routes/**"] },
  ];
  const picked = selectRules(rules, ["apps/webapp/app/routes/x.tsx"]).map(
    (r) => r.path
  );
  assert.deepEqual(picked, ["a.md", "c.md"]);
});

test("selectClaudeMdFiles: root plus any CLAUDE.md on a changed file's path", () => {
  const tree = [
    "CLAUDE.md",
    "apps/companion/CLAUDE.md",
    "apps/webapp/CLAUDE.md",
    "README.md",
  ];
  assert.deepEqual(selectClaudeMdFiles(tree, ["apps/companion/src/a.tsx"]), [
    "CLAUDE.md",
    "apps/companion/CLAUDE.md",
  ]);
});

test("classifyFile: areas", () => {
  assert.deepEqual(
    classifyFile("apps/webapp/app/routes/api+/mobile+/assets.ts"),
    ["mobileApi", "routes"]
  );
  assert.deepEqual(
    classifyFile("apps/webapp/app/modules/asset/service.server.ts"),
    ["server"]
  );
  assert.deepEqual(classifyFile("packages/database/prisma/schema.prisma"), [
    "schema",
    "packages",
  ]);
  assert.deepEqual(
    classifyFile("packages/database/prisma/migrations/2026_x/migration.sql"),
    ["migrations", "packages"]
  );
  assert.deepEqual(classifyFile("apps/webapp/package.json"), ["deps"]);
  assert.deepEqual(classifyFile("packages/permissions/src/index.ts"), [
    "auth",
    "packages",
  ]);
  assert.deepEqual(
    classifyFile("apps/webapp/app/modules/auth/service.server.ts"),
    ["server", "auth"]
  );
  assert.deepEqual(classifyFile("apps/companion/app/index.tsx"), ["companion"]);
  assert.deepEqual(classifyFile("apps/webapp/app/utils/x.test.ts"), ["tests"]);
  assert.deepEqual(classifyFile("apps/webapp/app/components/x.tsx"), []);
});

test("summarizeAreas counts files per area", () => {
  assert.deepEqual(
    summarizeAreas([
      { path: "apps/webapp/app/routes/a.tsx" },
      { path: "apps/webapp/app/routes/b.tsx" },
    ]),
    { routes: 2 }
  );
});

test("countChangedLines ignores lockfile and snapshot churn", () => {
  const files = [
    { path: "pnpm-lock.yaml", additions: 4000, deletions: 3000 },
    { path: "apps/webapp/app/x.test.ts.snap", additions: 900, deletions: 0 },
    { path: "apps/webapp/__snapshots__/y.snap", additions: 50, deletions: 0 },
    { path: "apps/webapp/app/x.ts", additions: 10, deletions: 5 },
  ];
  assert.equal(countChangedLines(files), 15);
});

test("pickTier", () => {
  assert.equal(pickTier({ changedLines: 120, fileCount: 3, areas: {} }), "S");
  assert.equal(
    pickTier({ changedLines: 120, fileCount: 3, areas: { routes: 1 } }),
    "M"
  );
  assert.equal(pickTier({ changedLines: 151, fileCount: 3, areas: {} }), "M");
  assert.equal(pickTier({ changedLines: 1501, fileCount: 3, areas: {} }), "L");
  assert.equal(pickTier({ changedLines: 200, fileCount: 31, areas: {} }), "L");
});

test("pickPasses: S runs nothing; M/L run security and impact only when triggered", () => {
  assert.deepEqual(pickPasses("S", { routes: 1 }), {
    bugs: false,
    tests: false,
    conventions: false,
    security: false,
    impact: false,
  });
  assert.deepEqual(pickPasses("M", {}), {
    bugs: true,
    tests: true,
    conventions: true,
    security: false,
    impact: false,
  });
  assert.deepEqual(pickPasses("M", { routes: 2 }), {
    bugs: true,
    tests: true,
    conventions: true,
    security: true,
    impact: false,
  });
  assert.deepEqual(pickPasses("L", { mobileApi: 1, routes: 1 }), {
    bugs: true,
    tests: true,
    conventions: true,
    security: true,
    impact: true,
  });
  assert.deepEqual(pickPasses("M", { companion: 1 }), {
    bugs: true,
    tests: true,
    conventions: true,
    security: false,
    impact: true,
  });
});

test("summarizeChecks", () => {
  const rollup = [
    { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
    { name: "test (1)", status: "COMPLETED", conclusion: "FAILURE" },
    { name: "test (2)", status: "IN_PROGRESS", conclusion: "" },
    { context: "coderabbit", state: "SUCCESS" },
    { context: "vercel", state: "ERROR" },
  ];
  assert.deepEqual(summarizeChecks(rollup), {
    failing: ["test (1)", "vercel"],
    pending: 1,
    passing: 2,
  });
  assert.deepEqual(summarizeChecks(null), {
    failing: [],
    pending: 0,
    passing: 0,
  });
});

/**
 * Builds a fake Runner. `responses` is an ordered list of [commandPrefix, result];
 * the first prefix the joined command starts with answers it. Unknown commands fail.
 */
function fakeRun(responses) {
  return (cmd, args) => {
    const key = [cmd, ...args].join(" ");
    for (const [prefix, result] of responses) {
      if (key.startsWith(prefix))
        return { code: 0, stdout: "", stderr: "", ...result };
    }
    return { code: 1, stdout: "", stderr: `unexpected command: ${key}` };
  };
}

const HEAD_SHA = "a".repeat(40);
const PR_VIEW = {
  number: 3191,
  title: "fix: confirm before delete",
  body: "Adds a confirm dialog.",
  url: "https://github.com/Shelf-nu/shelf.nu/pull/3191",
  state: "OPEN",
  isDraft: false,
  headRefName: "fix/delete-confirm",
  headRefOid: HEAD_SHA,
  baseRefName: "main",
  labels: [{ name: "fix" }],
  closingIssuesReferences: [
    { number: 3100, url: "https://github.com/Shelf-nu/shelf.nu/issues/3100" },
  ],
  statusCheckRollup: [
    { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
  ],
};
const FILES_JSONL = [
  {
    path: "apps/webapp/app/routes/_layout+/assets.$id.tsx",
    additions: 40,
    deletions: 2,
    status: "modified",
  },
  {
    path: "pnpm-lock.yaml",
    additions: 900,
    deletions: 900,
    status: "modified",
  },
]
  .map((f) => JSON.stringify(f))
  .join("\n");
const RULE_SCOPED = `---\ndescription: Org scope\npaths:\n  - "apps/webapp/app/routes/**"\n---\nbody`;
const RULE_OTHER = `---\ndescription: Companion only\npaths:\n  - "apps/companion/**"\n---\nbody`;

/** The happy-path command table; tests override entries by putting theirs first. */
function baseResponses({
  localHead = HEAD_SHA,
  prView = PR_VIEW,
  files = FILES_JSONL,
} = {}) {
  return [
    ["git rev-parse --abbrev-ref HEAD", { stdout: "fix/delete-confirm\n" }],
    [
      "gh pr list --head fix/delete-confirm --state open",
      { stdout: '[{"number":3191,"title":"x"}]' },
    ],
    ["gh pr view 3191", { stdout: JSON.stringify(prView) }],
    [
      "gh api --paginate repos/{owner}/{repo}/pulls/3191/files",
      { stdout: files + "\n" },
    ],
    ["gh pr diff 3191", { stdout: "diff --git a/x b/x\n" }],
    ["git rev-parse HEAD", { stdout: localHead + "\n" }],
    [
      "git ls-tree -r --name-only origin/main -- .claude/rules",
      {
        stdout:
          ".claude/rules/org.md\n.claude/rules/companion.md\n.claude/rules/no-em-dashes.md\n",
      },
    ],
    ["git show origin/main:.claude/rules/org.md", { stdout: RULE_SCOPED }],
    ["git show origin/main:.claude/rules/companion.md", { stdout: RULE_OTHER }],
    [
      "git show origin/main:.claude/rules/no-em-dashes.md",
      { stdout: "# No em dashes\n" },
    ],
    [
      "git ls-tree -r --name-only origin/main",
      { stdout: "CLAUDE.md\napps/companion/CLAUDE.md\nREADME.md\n" },
    ],
    ["git show origin/main:CLAUDE.md", { stdout: "# CLAUDE\n" }],
  ];
}

test("resolvePrNumber: explicit number wins, junk is rejected", () => {
  assert.equal(resolvePrNumber(fakeRun([]), "42"), 42);
  assert.throws(() => resolvePrNumber(fakeRun([]), "abc"), ContextError);
});

test("resolvePrNumber: refuses main, detached HEAD, no PR, several PRs", () => {
  const on = (branch, prs) =>
    fakeRun([
      ["git rev-parse --abbrev-ref HEAD", { stdout: `${branch}\n` }],
      ["gh pr list", { stdout: JSON.stringify(prs) }],
    ]);
  assert.throws(() => resolvePrNumber(on("main", [])), /on main/);
  assert.throws(() => resolvePrNumber(on("HEAD", [])), /detached HEAD/);
  assert.throws(
    () => resolvePrNumber(on("feat/x", [])),
    /no open PR for branch feat\/x/
  );
  assert.throws(
    () => resolvePrNumber(on("feat/x", [{ number: 1 }, { number: 2 }])),
    (err) => err instanceof ContextError && err.extra.candidates.length === 2
  );
});

test("collectContext: happy path", () => {
  const { context, artifacts } = collectContext({
    run: fakeRun(baseResponses()),
    startedAt: 1000,
    marker: "m1",
  });
  assert.equal(context.pr.number, 3191);
  assert.deepEqual(context.pr.labels, ["fix"]);
  assert.deepEqual(context.pr.linkedIssues, [
    "https://github.com/Shelf-nu/shelf.nu/issues/3100",
  ]);
  assert.equal(context.diffSource, "github");
  assert.equal(context.localHeadMatchesPr, true);
  assert.equal(context.stats.changedLines, 42);
  assert.equal(context.stats.countedFiles, 1);
  assert.equal(context.tier, "M");
  assert.equal(context.passes.security, true);
  assert.deepEqual(
    context.rules.map((r) => r.path),
    [".claude/rules/org.md", ".claude/rules/no-em-dashes.md"]
  );
  assert.deepEqual(context.claudeMd, ["CLAUDE.md"]);
  assert.equal(context.rulesRef, "origin/main");
  assert.equal(context.selfModified, false);
  assert.deepEqual(context.warnings, []);
  assert.equal(artifacts.diff, "diff --git a/x b/x\n");
  assert.equal(artifacts.rules[0].content, RULE_SCOPED);
});

test("collectContext: warns when local HEAD is not the PR head", () => {
  const { context } = collectContext({
    run: fakeRun(baseResponses({ localHead: "b".repeat(40) })),
    startedAt: 0,
    marker: "m",
  });
  assert.equal(context.localHeadMatchesPr, false);
  assert.match(context.warnings.join("\n"), /not the PR head/);
});

test("collectContext: falls back to the local diff when GitHub refuses it", () => {
  const run = fakeRun([
    ["gh pr diff 3191", { code: 1, stderr: "diff too large" }],
    ["git merge-base origin/main HEAD", { stdout: "c".repeat(40) + "\n" }],
    [`git diff ${"c".repeat(40)} HEAD`, { stdout: "local diff\n" }],
    ...baseResponses(),
  ]);
  const { context, artifacts } = collectContext({
    run,
    startedAt: 0,
    marker: "m",
  });
  assert.equal(context.diffSource, "local");
  assert.equal(artifacts.diff, "local diff\n");
  assert.match(context.warnings.join("\n"), /diff too large/);
});

test("collectContext: flags a PR that edits the reviewer itself", () => {
  const files = JSON.stringify({
    path: ".claude/agents/shelf-pr-reviewer-tests.md",
    additions: 3,
    deletions: 1,
    status: "modified",
  });
  const { context } = collectContext({
    run: fakeRun(baseResponses({ files })),
    startedAt: 0,
    marker: "m",
  });
  assert.equal(context.selfModified, true);
  assert.match(context.warnings.join("\n"), /reviewer's own/);
});

test("collectContext: explicit number for a merged PR is allowed with a warning", () => {
  const run = fakeRun(
    baseResponses({ prView: { ...PR_VIEW, state: "MERGED" } })
  );
  const { context } = collectContext({
    run,
    prArg: "3191",
    startedAt: 0,
    marker: "m",
  });
  assert.equal(context.pr.state, "MERGED");
  assert.match(context.warnings.join("\n"), /PR is MERGED/);
});

test("collectContext: reads rules from the PR branch, with a warning, when the base ref is missing", () => {
  const run = fakeRun([
    [
      "git ls-tree -r --name-only origin/main -- .claude/rules",
      { code: 128, stderr: "not a tree" },
    ],
    [
      "git ls-tree -r --name-only HEAD -- .claude/rules",
      { stdout: ".claude/rules/org.md\n" },
    ],
    ["git show HEAD:.claude/rules/org.md", { stdout: RULE_SCOPED }],
    ["git ls-tree -r --name-only HEAD", { stdout: "CLAUDE.md\n" }],
    ["git show HEAD:CLAUDE.md", { stdout: "# CLAUDE\n" }],
    ...baseResponses(),
  ]);
  const { context } = collectContext({ run, startedAt: 0, marker: "m" });
  assert.equal(context.rulesRef, "HEAD");
  assert.match(context.warnings.join("\n"), /origin\/main not found locally/);
});
