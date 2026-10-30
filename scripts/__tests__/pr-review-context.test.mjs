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
  artifactDir,
  ContextError,
  httpsRepoUrl,
  editedPrFiles,
  flattenPath,
  splitDiff,
  splitSqlStatements,
  classifySqlStatement,
  summarizeSchemaDiff,
  extractDbChanges,
  createTableColumns,
  createTableConstraints,
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

test("globToRegExp: an unclosed brace is a literal and does not hang", () => {
  assert.ok(globToRegExp("a/{b").test("a/{b"));
  assert.ok(!globToRegExp("a/{b").test("a/b"));
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
// why: collectContext shells out to git and gh, which need network, gh auth and
// a live PR; a scripted Runner keeps these tests hermetic and deterministic.
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
  isCrossRepository: false,
  author: { login: "octo", name: "Octo Cat" },
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
    ["git fetch origin main", {}],
    [
      "gh api --paginate repos/{owner}/{repo}/pulls/3191/files",
      { stdout: files + "\n" },
    ],
    ["gh pr diff 3191", { stdout: "diff --git a/x b/x\n" }],
    ["git rev-parse HEAD", { stdout: localHead + "\n" }],
    ["git status --porcelain=v1 --untracked-files=no", { stdout: "" }],
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
  assert.equal(context.pr.isCrossRepository, false);
  assert.equal(context.pr.author, "octo");
});

/**
 * Wraps a runner so every call is recorded with its options.
 * @returns {{run: Function, calls: Array<{key: string, options: object}>}}
 */
function recording(run) {
  const calls = [];
  return {
    calls,
    run: (cmd, args, options) => {
      calls.push({ key: [cmd, ...args].join(" "), options });
      return run(cmd, args, options);
    },
  };
}

test("collectContext: fetches the base branch non-interactively before reading rules", () => {
  const { run, calls } = recording(fakeRun(baseResponses()));
  collectContext({ run, startedAt: 0, marker: "m" });
  const fetchIndex = calls.findIndex((c) => c.key === "git fetch origin main");
  assert.ok(fetchIndex >= 0, "git fetch origin main ran");
  assert.equal(calls[fetchIndex].options.env.GIT_TERMINAL_PROMPT, "0");
  assert.match(calls[fetchIndex].options.env.GIT_SSH_COMMAND, /BatchMode=yes/);
  const rulesIndex = calls.findIndex((c) =>
    c.key.startsWith("git ls-tree -r --name-only origin/main -- .claude/rules")
  );
  assert.ok(fetchIndex < rulesIndex, "fetch happens before the rules are read");
});

test("collectContext: SSH and HTTPS fetch both failing only warns, naming how old origin/main is", () => {
  const run = fakeRun([
    ["git fetch origin main", { code: 128, stderr: "Permission denied" }],
    ["git fetch https://", { code: 128, stderr: "Could not resolve host" }],
    ["git log -1 --format=%cr origin/main", { stdout: "3 days ago\n" }],
    ...baseResponses(),
  ]);
  const { context } = collectContext({ run, startedAt: 0, marker: "m" });
  assert.match(
    context.warnings.join("\n"),
    /could not fetch origin\/main \(its newest local commit is from 3 days ago\); rules may be stale/
  );
});

test("collectContext: a failed SSH fetch falls back to HTTPS without a warning", () => {
  const calls = [];
  const inner = fakeRun([
    ["git fetch origin main", { code: 128, stderr: "Permission denied" }],
    ["git fetch https://github.com/Shelf-nu/shelf.nu.git", {}],
    ...baseResponses(),
  ]);
  const run = (cmd, args, options) => {
    calls.push([cmd, ...args].join(" "));
    return inner(cmd, args, options);
  };
  const { context } = collectContext({ run, startedAt: 0, marker: "m" });
  assert.ok(
    calls.includes(
      "git fetch https://github.com/Shelf-nu/shelf.nu.git +refs/heads/main:refs/remotes/origin/main"
    )
  );
  assert.ok(!context.warnings.some((w) => w.includes("could not fetch")));
});

test("httpsRepoUrl: builds the clone URL from a PR URL, null otherwise", () => {
  assert.equal(
    httpsRepoUrl("https://github.com/Shelf-nu/shelf.nu/pull/3191"),
    "https://github.com/Shelf-nu/shelf.nu.git"
  );
  assert.equal(httpsRepoUrl(undefined), null);
  assert.equal(httpsRepoUrl("not a url"), null);
});

test("collectContext: refuses to review from a different branch", () => {
  const run = fakeRun([
    ["git rev-parse --abbrev-ref HEAD", { stdout: "main\n" }],
    ...baseResponses({ localHead: "b".repeat(40) }),
  ]);
  assert.throws(
    () => collectContext({ run, prArg: "3191", startedAt: 0, marker: "m" }),
    (err) =>
      err instanceof ContextError &&
      /you are on main, not the PR branch fix\/delete-confirm: run gh pr checkout 3191 first/.test(
        err.message
      )
  );
});

test("collectContext: a detached HEAD exactly at the PR head is allowed", () => {
  const run = fakeRun([
    ["git rev-parse --abbrev-ref HEAD", { stdout: "HEAD\n" }],
    ...baseResponses(),
  ]);
  const { context } = collectContext({
    run,
    prArg: "3191",
    startedAt: 0,
    marker: "m",
  });
  assert.equal(context.localHeadMatchesPr, true);
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
    [
      `git merge-base origin/main ${HEAD_SHA}`,
      { stdout: "c".repeat(40) + "\n" },
    ],
    [`git diff ${"c".repeat(40)} ${HEAD_SHA}`, { stdout: "local diff\n" }],
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

test("collectContext: a PR that only edits a project rule is not self-modifying", () => {
  const files = JSON.stringify({
    path: ".claude/rules/x.md",
    additions: 3,
    deletions: 1,
    status: "modified",
  });
  const { context } = collectContext({
    run: fakeRun(baseResponses({ files })),
    startedAt: 0,
    marker: "m",
  });
  assert.equal(context.selfModified, false);
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

test("collectContext: runs without rules, never the PR's own copies, when the base ref is missing", () => {
  const calls = [];
  const inner = fakeRun([
    [
      "git ls-tree -r --name-only origin/main -- .claude/rules",
      { code: 128, stderr: "not a tree" },
    ],
    ...baseResponses(),
  ]);
  const run = (cmd, args, options) => {
    calls.push([cmd, ...args].join(" "));
    return inner(cmd, args, options);
  };
  const { context, artifacts } = collectContext({
    run,
    startedAt: 0,
    marker: "m",
  });
  assert.equal(context.rulesRef, null);
  assert.deepEqual(artifacts.rules, []);
  assert.deepEqual(artifacts.claudeMd, []);
  assert.ok(
    !calls.some((c) => c.includes("HEAD:")),
    "nothing is read from HEAD"
  );
  assert.match(
    context.warnings.join("\n"),
    /origin\/main not found locally: the review runs without project rules/
  );
});

test("collectContext: uncommitted edits to PR files mean the checkout is not the PR", () => {
  const run = fakeRun([
    [
      "git status --porcelain=v1 --untracked-files=no",
      { stdout: " M apps/webapp/app/routes/a.tsx\n" },
    ],
    ...baseResponses(),
  ]);
  const { context } = collectContext({ run, startedAt: 0, marker: "m" });
  assert.equal(context.localHeadMatchesPr, false);
  assert.match(
    context.warnings.join("\n"),
    /Uncommitted edits to PR files \(apps\/webapp\/app\/routes\/a\.tsx\)/
  );
});

test("editedPrFiles: checks only the PR's paths, ignores untracked files, and treats a git failure as clean", () => {
  let seen;
  const run = (cmd, args) => {
    seen = [cmd, ...args];
    return { code: 0, stdout: "M  a.ts\n M b.ts\n", stderr: "" };
  };
  assert.deepEqual(editedPrFiles(run, ["a.ts", "b.ts"]), ["a.ts", "b.ts"]);
  assert.ok(seen.includes("--untracked-files=no"));
  assert.deepEqual(seen.slice(-3), ["--", "a.ts", "b.ts"]);
  const failing = () => ({ code: 128, stdout: "", stderr: "boom" });
  assert.deepEqual(editedPrFiles(failing, ["a.ts"]), []);
});

test("flattenPath: distinct paths always give distinct names", () => {
  assert.equal(
    flattenPath(".claude/rules/a/x.md"),
    ".claude%2Frules%2Fa%2Fx.md"
  );
  const pairs = [
    [".claude/rules/a/x.md", ".claude/rules/b/x.md"],
    [".claude/rules/a__b/x.md", ".claude/rules/a/b__x.md"],
    [".claude/rules/a%2Fb.md", ".claude/rules/a/b.md"],
  ];
  for (const [left, right] of pairs) {
    assert.notEqual(flattenPath(left), flattenPath(right));
  }
  assert.ok(!flattenPath("a/b/c.md").includes("/"));
});

test("artifactDir: artifacts live in .pr-review/<n> at the worktree root", () => {
  const run = fakeRun([
    ["git rev-parse --show-toplevel", { stdout: "/repo/wt\n" }],
  ]);
  assert.equal(artifactDir(run, 3191), "/repo/wt/.pr-review/3191");
});

/** Prefixes every line with `+`, as a diff shows a new file's content. */
const added = (text) =>
  text
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");

/** A trimmed copy of the PdfDocument migration, as `gh pr diff` shows a new file. */
const PDF_MIGRATION_DIFF = `diff --git a/packages/database/prisma/migrations/20261028120000_add_pdf_documents/migration.sql b/packages/database/prisma/migrations/20261028120000_add_pdf_documents/migration.sql
new file mode 100644
index 000000000..111111111
--- /dev/null
+++ b/packages/database/prisma/migrations/20261028120000_add_pdf_documents/migration.sql
@@ -0,0 +1,30 @@
${added(`-- PDF documents: saved layouts; a ; in a comment is not a statement end.
CREATE TYPE "PdfDocumentKind" AS ENUM ('BOOKING');

CREATE TABLE "PdfDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PdfDocumentKind" NOT NULL DEFAULT 'BOOKING',
    "note" TEXT,

    CONSTRAINT "PdfDocument_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PdfDocument" ADD CONSTRAINT "PdfDocument_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "PdfDocument_one_default" ON "PdfDocument"("organizationId", "kind") WHERE "isDefault";
ALTER TABLE "PdfDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Organization" ADD COLUMN "paidPdfDocumentsSeededAt" TIMESTAMP(3);
INSERT INTO "PdfDocument" ("id", "name") SELECT gen_random_uuid()::text, 'Check; list' FROM "Organization" o;`)}
diff --git a/packages/database/prisma/schema.prisma b/packages/database/prisma/schema.prisma
index 222222222..333333333 100644
--- a/packages/database/prisma/schema.prisma
+++ b/packages/database/prisma/schema.prisma
@@ -430,3 +430,12 @@ model Organization {
   name String
+model PdfDocument {
+  id String @id
+}
+enum PdfDocumentKind {
+  BOOKING
+}
diff --git a/apps/webapp/app/x.ts b/apps/webapp/app/x.ts
index 444444444..555555555 100644
--- a/apps/webapp/app/x.ts
+++ b/apps/webapp/app/x.ts
@@ -1,1 +1,1 @@
-const a = 1;
+const a = 2;
`;

test("splitDiff: per-file added and removed lines, and new or deleted files", () => {
  const files = splitDiff(PDF_MIGRATION_DIFF);
  assert.deepEqual(
    files.map((f) => [f.path, f.status]),
    [
      [
        "packages/database/prisma/migrations/20261028120000_add_pdf_documents/migration.sql",
        "added",
      ],
      ["packages/database/prisma/schema.prisma", "modified"],
      ["apps/webapp/app/x.ts", "modified"],
    ]
  );
  assert.deepEqual(files[2].added, ["const a = 2;"]);
  assert.deepEqual(files[2].removed, ["const a = 1;"]);
});

test("splitSqlStatements: ignores semicolons in comments, quotes and dollar-quoted bodies", () => {
  const sql = `-- a; b
SELECT 'x;y';
CREATE FUNCTION f() RETURNS trigger AS $$ BEGIN NEW.a := 1; RETURN NEW; END; $$ LANGUAGE plpgsql;
UPDATE "T" SET a = 1`;
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 3);
  assert.equal(statements[0], "SELECT 'x;y'");
  assert.match(statements[1], /^CREATE FUNCTION f\(\).*plpgsql$/s);
});

test("classifySqlStatement: renames, drops and multi-clause ALTER TABLE are each listed", () => {
  const one = (sql) => classifySqlStatement(sql);
  assert.deepEqual(one(`ALTER TABLE "PdfDocument" RENAME TO "PdfTemplate"`), [
    { action: "rename table", target: "PdfDocument", detail: "to PdfTemplate" },
  ]);
  assert.deepEqual(one(`ALTER TABLE "Asset" RENAME COLUMN "a" TO "b"`), [
    { action: "rename column", target: "Asset.a", detail: "to b" },
  ]);
  assert.deepEqual(
    one(
      `ALTER TABLE "Asset" DROP COLUMN "old",\nADD COLUMN "new" TEXT NOT NULL`
    ).map((s) => [s.action, s.target]),
    [
      ["drop column", "Asset.old"],
      ["add column", "Asset.new"],
    ]
  );
  assert.deepEqual(
    one(`ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'X'`),
    [{ action: "add enum value", target: "ActivityAction", detail: "X" }]
  );
  assert.deepEqual(one(`DROP TABLE "Old"`), [
    { action: "drop table", target: "Old", detail: "" },
  ]);
  assert.equal(one(`COMMENT ON TABLE "T" IS 'x'`)[0].action, "other");
});

test("summarizeSchemaDiff: added and removed blocks, a moved block is not a change", () => {
  assert.deepEqual(
    summarizeSchemaDiff({
      added: ["model New {", "model Moved {", "enum E {", '  @@map("new")'],
      removed: ["model Gone {", "model Moved {"],
    }),
    {
      modelsAdded: ["New"],
      modelsRemoved: ["Gone"],
      enumsAdded: ["E"],
      enumsRemoved: [],
      mapsChanged: ['+ @@map("new")'],
    }
  );
});

test("extractDbChanges: lists every statement of the PdfDocument migration", () => {
  const db = extractDbChanges(PDF_MIGRATION_DIFF);
  assert.equal(db.migrations.length, 1);
  assert.equal(db.migrations[0].status, "added");
  assert.deepEqual(db.editedMigrations, []);
  assert.deepEqual(
    db.migrations[0].statements.map((s) => [s.action, s.target]),
    [
      ["create enum", "PdfDocumentKind"],
      ["create table", "PdfDocument"],
      ["add constraint", "PdfDocument"],
      ["add foreign key", "PdfDocument(organizationId)"],
      ["create unique index", "PdfDocument_one_default"],
      ["row level security", "PdfDocument"],
      ["add column", "Organization.paidPdfDocumentsSeededAt"],
      ["insert rows", "PdfDocument"],
    ]
  );
  const [, table, , fk, index] = db.migrations[0].statements;
  assert.equal(
    table.detail,
    "id text, name text, kind PdfDocumentKind, note text null"
  );
  assert.equal(
    fk.detail,
    "PdfDocument_organizationId_fkey -> Organization, on delete cascade"
  );
  assert.equal(
    index.detail,
    "on PdfDocument(organizationId, kind) where isDefault"
  );
  assert.deepEqual(db.schema.modelsAdded, ["PdfDocument"]);
  assert.deepEqual(db.schema.enumsAdded, ["PdfDocumentKind"]);
});

test("extractDbChanges: null without database files; flags an edited existing migration", () => {
  assert.equal(
    extractDbChanges("diff --git a/x.ts b/x.ts\n@@ -1 +1 @@\n+a\n"),
    null
  );
  const edited = `diff --git a/packages/database/prisma/migrations/1_x/migration.sql b/packages/database/prisma/migrations/1_x/migration.sql
index 1..2 100644
--- a/packages/database/prisma/migrations/1_x/migration.sql
+++ b/packages/database/prisma/migrations/1_x/migration.sql
@@ -1 +1 @@
-ALTER TABLE "A" ADD COLUMN "b" TEXT;
+ALTER TABLE "A" ADD COLUMN "c" TEXT;
`;
  const db = extractDbChanges(edited);
  assert.deepEqual(db.editedMigrations, [
    "packages/database/prisma/migrations/1_x/migration.sql",
  ]);
  assert.equal(db.schema, null);
});

test("collectContext: db is null for a PR without database changes", () => {
  const { context } = collectContext({
    run: fakeRun(baseResponses()),
    startedAt: 1000,
    marker: "m1",
  });
  assert.equal(context.db, null);
});

test("collectContext: a PR editing an existing migration warns", () => {
  const diff = `diff --git a/packages/database/prisma/migrations/1_x/migration.sql b/packages/database/prisma/migrations/1_x/migration.sql
index 1..2 100644
@@ -1 +1 @@
+UPDATE "A" SET b = 1;
`;
  const { context } = collectContext({
    run: fakeRun([["gh pr diff 3191", { stdout: diff }], ...baseResponses()]),
    startedAt: 1000,
    marker: "m1",
  });
  assert.equal(context.db.migrations[0].statements[0].action, "update rows");
  assert.ok(
    context.warnings.some((w) => w.includes("changes or deletes migrations"))
  );
});

test("createTableColumns: name, type, nullability and default per column, constraints skipped", () => {
  assert.deepEqual(
    createTableColumns(`
    "id" TEXT NOT NULL,
    "kind" "PdfDocumentKind" NOT NULL DEFAULT 'BOOKING',
    "config" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PdfDocument_pkey" PRIMARY KEY ("id")
`),
    [
      { name: "id", type: "text", nullable: false, default: "" },
      {
        name: "kind",
        type: "PdfDocumentKind",
        nullable: false,
        default: "'BOOKING'",
      },
      { name: "config", type: "jsonb", nullable: false, default: "'{}'" },
      { name: "note", type: "text", nullable: true, default: "" },
      {
        name: "createdAt",
        type: "timestamp(3)",
        nullable: false,
        default: "CURRENT_TIMESTAMP",
      },
    ]
  );
});

test("createTableConstraints: inline checks and keys are listed, not dropped", () => {
  const body = `
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "LinkPreview_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LinkPreview_url_length" CHECK (char_length("url") <= 2048)
`;
  assert.deepEqual(createTableConstraints("LinkPreview", body), [
    {
      action: "add constraint",
      target: "LinkPreview",
      detail: "LinkPreview_pkey: PRIMARY KEY (id)",
    },
    {
      action: "add constraint",
      target: "LinkPreview",
      detail: "LinkPreview_url_length: CHECK (char_length(url) <= 2048)",
    },
  ]);
  assert.deepEqual(
    classifySqlStatement(`CREATE TABLE "LinkPreview" (${body})`).map(
      (s) => s.action
    ),
    ["create table", "add constraint", "add constraint"]
  );
});

test("createTableColumns: an enum type keeps its name, built-in types are lower case", () => {
  assert.deepEqual(
    createTableColumns(
      `"outcome" "LinkPreviewOutcome",\n"n" INTEGER NOT NULL`
    ).map((c) => c.type),
    ["LinkPreviewOutcome", "integer"]
  );
});
