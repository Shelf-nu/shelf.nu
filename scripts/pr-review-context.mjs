#!/usr/bin/env node
/**
 * pr-review-context.mjs: the setup step of the /pr-review skill.
 *
 * Collects everything the reviewers need in one call: the PR for the current
 * branch (or an explicit number), its diff and per-file stats from GitHub, the
 * touched areas, the review tier (S/M/L), which specialist passes to run, and
 * the project rules and CLAUDE.md files that apply to the changed paths. Rules
 * are read from the base branch so a PR cannot loosen the rules it is judged by.
 *
 * Usage: node scripts/pr-review-context.mjs [pr-number]
 *
 * Prints the context JSON to stdout and writes the diff and rule copies under
 * <worktree-root>/.pr-review/<pr>/ (gitignored). When no PR can be resolved it prints
 * {"error": "...", ...} and exits 3.
 *
 * Contains no review judgement: it only measures and selects.
 *
 * @see ../.claude/skills/pr-review/SKILL.md
 */

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Files whose line churn says nothing about review effort. */
const UNCOUNTED_FILE = /(^|\/)(pnpm-lock\.yaml|[^/]+\.snap)$/;

/** Areas that make a small PR too risky for the inline S tier. */
const RISKY_AREAS = ["routes", "server", "schema", "migrations"];

/**
 * Area tests, in output order. A file can belong to several areas.
 * @type {Array<[string, (file: string) => boolean]>}
 */
const AREAS = [
  ["mobileApi", (f) => f.startsWith("apps/webapp/app/routes/api+/mobile+/")],
  ["routes", (f) => f.startsWith("apps/webapp/app/routes/")],
  [
    "server",
    (f) => /\.server\.tsx?$/.test(f) || f.startsWith("apps/webapp/server/"),
  ],
  ["schema", (f) => f === "packages/database/prisma/schema.prisma"],
  ["migrations", (f) => f.startsWith("packages/database/prisma/migrations/")],
  [
    "deps",
    (f) =>
      /(^|\/)package\.json$/.test(f) ||
      f === "pnpm-lock.yaml" ||
      f === "pnpm-workspace.yaml",
  ],
  [
    "auth",
    (f) => /(^|\/)(auth|sso|scim|supabase|permissions)(\/|\.|$)/i.test(f),
  ],
  ["packages", (f) => f.startsWith("packages/")],
  ["companion", (f) => f.startsWith("apps/companion/")],
  [
    "tests",
    (f) => /\.test\.tsx?$/.test(f) || f.startsWith("apps/webapp/test/"),
  ],
];

/**
 * Escapes a string for literal use inside a RegExp.
 * @param {string} text
 * @returns {string}
 */
function escapeRegExp(text) {
  return text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/**
 * Converts the glob dialect used in `.claude/rules` `paths` frontmatter into a
 * RegExp source (no anchors). Supports `**` (any depth, `**\/` also zero
 * directories), `*` and `?` (within one path segment) and `{a,b}` alternatives.
 * A `{` without a closing `}` is matched literally.
 * @param {string} glob
 * @returns {string}
 */
function globSource(glob) {
  let source = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 2;
      } else {
        source += ".*";
        i += 1;
      }
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      const end = glob.indexOf("}", i);
      // An unclosed brace has no alternatives: match it literally.
      if (end === -1) {
        source += escapeRegExp(char);
        continue;
      }
      const alternatives = glob
        .slice(i + 1, end)
        .split(",")
        .map(globSource);
      source += `(?:${alternatives.join("|")})`;
      i = end;
    } else {
      source += escapeRegExp(char);
    }
  }
  return source;
}

/**
 * Compiles a rules-frontmatter glob into an anchored RegExp.
 * @param {string} glob - e.g. `apps/webapp/app/**\/*.{ts,tsx}`
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  return new RegExp(`^${globSource(glob)}$`);
}

/**
 * @param {string} file - repo-relative path
 * @param {string} glob
 * @returns {boolean} whether the file matches the glob
 */
export function matchesGlob(file, glob) {
  return globToRegExp(glob).test(file);
}

/**
 * Reads `description` and the `paths` block list from a rule file's YAML
 * frontmatter. Only the shapes used in `.claude/rules` are supported.
 * @param {string} markdown
 * @returns {{description: string, paths: string[]}} empty paths when absent
 */
export function parseRuleFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { description: "", paths: [] };
  let description = "";
  const paths = [];
  let inPaths = false;
  for (const line of match[1].split("\n")) {
    if (line.startsWith("description:")) {
      description = line
        .slice("description:".length)
        .trim()
        .replace(/^["']|["']$/g, "");
      inPaths = false;
    } else if (/^paths:\s*$/.test(line)) {
      inPaths = true;
    } else if (inPaths && /^\s+-\s+/.test(line)) {
      paths.push(
        line
          .replace(/^\s+-\s+/, "")
          .trim()
          .replace(/^["']|["']$/g, "")
      );
    } else if (/^\S/.test(line)) {
      inPaths = false;
    }
  }
  return { description, paths };
}

/**
 * Keeps the rules that apply to this change: rules without `paths` apply
 * everywhere; the rest need at least one changed file matching a glob.
 * @template {{paths: string[]}} R
 * @param {R[]} rules
 * @param {string[]} files - changed repo-relative paths
 * @returns {R[]}
 */
export function selectRules(rules, files) {
  return rules.filter(
    (rule) =>
      rule.paths.length === 0 ||
      files.some((file) => rule.paths.some((glob) => matchesGlob(file, glob)))
  );
}

/**
 * Picks the CLAUDE.md files that govern the change: the root one plus any in a
 * directory that contains a changed file.
 * @param {string[]} treePaths - every path in the base tree
 * @param {string[]} files - changed repo-relative paths
 * @returns {string[]}
 */
export function selectClaudeMdFiles(treePaths, files) {
  return treePaths.filter((p) => {
    if (p === "CLAUDE.md") return true;
    if (!p.endsWith("/CLAUDE.md")) return false;
    const dir = p.slice(0, -"CLAUDE.md".length);
    return files.some((file) => file.startsWith(dir));
  });
}

/**
 * @param {string} file - repo-relative path
 * @returns {string[]} the areas the file belongs to, in AREAS order
 */
export function classifyFile(file) {
  return AREAS.filter(([, test]) => test(file)).map(([name]) => name);
}

/**
 * @param {Array<{path: string}>} files
 * @returns {Record<string, number>} files per area; areas with no files are omitted
 */
export function summarizeAreas(files) {
  const counts = {};
  for (const file of files) {
    for (const area of classifyFile(file.path))
      counts[area] = (counts[area] ?? 0) + 1;
  }
  return counts;
}

/**
 * @param {string} file
 * @returns {boolean} false for lockfiles and snapshots, whose churn is not review effort
 */
export function isCounted(file) {
  return !UNCOUNTED_FILE.test(file);
}

/**
 * @param {Array<{path: string, additions: number, deletions: number}>} files
 * @returns {number} additions plus deletions over counted files
 */
export function countChangedLines(files) {
  return files
    .filter((f) => isCounted(f.path))
    .reduce((sum, f) => sum + f.additions + f.deletions, 0);
}

/**
 * Chooses how much review machinery a PR gets.
 * @param {{changedLines: number, fileCount: number, areas: Record<string, number>}} stats
 * @returns {"S" | "M" | "L"} L for big PRs, S for small PRs outside risky areas, else M
 */
export function pickTier({ changedLines, fileCount, areas }) {
  if (changedLines > 1500 || fileCount > 30) return "L";
  const risky = RISKY_AREAS.some((area) => areas[area]);
  if (changedLines <= 150 && !risky) return "S";
  return "M";
}

/**
 * Chooses the agent passes for M and L. In S the skill reviews inline, so no
 * agent pass runs.
 * @param {"S" | "M" | "L"} tier
 * @param {Record<string, number>} areas
 * @returns {{bugs: boolean, tests: boolean, conventions: boolean, security: boolean, impact: boolean}}
 */
export function pickPasses(tier, areas) {
  if (tier === "S")
    return {
      bugs: false,
      tests: false,
      conventions: false,
      security: false,
      impact: false,
    };
  const has = (...names) => names.some((name) => areas[name]);
  return {
    bugs: true,
    tests: true,
    conventions: true,
    security: has("routes", "server", "schema", "migrations", "auth", "deps"),
    impact: has(
      "mobileApi",
      "packages",
      "schema",
      "migrations",
      "deps",
      "server",
      "companion"
    ),
  };
}

/**
 * Condenses `gh pr view --json statusCheckRollup` into what the report shows.
 * Check runs carry status/conclusion; commit statuses carry state.
 * @param {Array<Record<string, string>> | null} rollup
 * @returns {{failing: string[], pending: number, passing: number}}
 */
export function summarizeChecks(rollup) {
  const result = { failing: [], pending: 0, passing: 0 };
  for (const check of rollup ?? []) {
    const name = check.name ?? check.context ?? "unknown";
    const outcome = check.conclusion || check.state || "";
    if (check.status && check.status !== "COMPLETED") result.pending += 1;
    else if (outcome === "PENDING" || outcome === "EXPECTED")
      result.pending += 1;
    else if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(outcome))
      result.passing += 1;
    else result.failing.push(name);
  }
  return result;
}

/** `gh pr view --json` fields the skill uses. */
const PR_FIELDS =
  "number,title,body,url,state,isDraft,isCrossRepository,author,headRefName,headRefOid,baseRefName,labels,closingIssuesReferences,statusCheckRollup";

/**
 * Paths that make up the reviewer itself; a PR touching them is reviewed by code
 * it changed. Project rules are excluded: they are always read from the base branch.
 */
const REVIEWER_PATH =
  /^(\.claude\/(skills\/pr-review\/|agents\/shelf-pr-|agents\/shelf-security)|scripts\/pr-review-context|CLAUDE\.md$)/;

/**
 * Environment for `git fetch`: never prompt for credentials and give up fast on
 * SSH, so an unreachable remote costs seconds instead of hanging the review.
 */
const NON_INTERACTIVE_GIT_ENV = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_SSH_COMMAND: "ssh -o BatchMode=yes -o ConnectTimeout=5",
};

/**
 * Runs one command. `options.env` adds variables to the inherited environment.
 * @typedef {(cmd: string, args: string[], options?: {env?: Record<string, string>}) => {code: number, stdout: string, stderr: string}} Runner
 */

/**
 * Turns a PR URL into the HTTPS clone URL of its repository, used to fetch the
 * base branch without SSH.
 * @param {string | undefined} prUrl - e.g. `https://github.com/Shelf-nu/shelf.nu/pull/3191`
 * @returns {string | null} e.g. `https://github.com/Shelf-nu/shelf.nu.git`, or null when it does not parse
 */
export function httpsRepoUrl(prUrl) {
  const match = /^(https:\/\/github\.com\/[^/]+\/[^/]+)\/pull\/\d+/.exec(
    prUrl ?? ""
  );
  return match ? `${match[1]}.git` : null;
}

/**
 * Turns a repo path into a single file name, so copies of files with the same
 * basename in different folders never overwrite each other.
 * @param {string} repoPath - e.g. `.claude/rules/a/x.md`
 * @returns {string} e.g. `.claude__rules__a__x.md`
 */
export function flattenPath(repoPath) {
  return repoPath.replaceAll("/", "__");
}

/**
 * Lists PR files with uncommitted (staged or unstaged) edits in the working
 * tree. Untracked files are ignored. A failing `git status` counts as clean,
 * since the HEAD comparison has already passed.
 * @param {Runner} run - command runner
 * @param {string[]} paths - the PR's changed paths
 * @returns {string[]} the edited paths, in `git status` order
 */
export function editedPrFiles(run, paths) {
  const status = run("git", [
    "status",
    "--porcelain=v1",
    "--untracked-files=no",
    "--",
    ...paths,
  ]);
  if (status.code !== 0) return [];
  return status.stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

/** A failure the skill reports to the user instead of reviewing. */
export class ContextError extends Error {
  /**
   * @param {string} message - plain-language reason shown to the user
   * @param {object} [extra] - structured detail, e.g. `candidates` when several PRs match
   */
  constructor(message, extra = {}) {
    super(message);
    this.extra = extra;
  }
}

/**
 * Runs a command through the runner and returns stdout, throwing on failure.
 * @param {Runner} run
 * @param {string} cmd
 * @param {string[]} args
 * @returns {string}
 * @throws {ContextError} when the command exits non-zero
 */
function must(run, cmd, args) {
  const result = run(cmd, args);
  if (result.code !== 0) {
    throw new ContextError(
      `${cmd} ${args.join(" ")} failed: ${result.stderr.trim()}`
    );
  }
  return result.stdout;
}

/**
 * Finds the PR to review: the explicit number, else the single open PR whose
 * head is the current branch.
 * @param {Runner} run
 * @param {string} [prArg] - PR number from the skill arguments
 * @returns {number}
 * @throws {ContextError} on a non-numeric argument, main, detached HEAD, or zero or several open PRs
 */
export function resolvePrNumber(run, prArg) {
  if (prArg) {
    if (!/^\d+$/.test(prArg))
      throw new ContextError(`not a PR number: ${prArg}`);
    return Number(prArg);
  }
  const branch = must(run, "git", ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  if (branch === "HEAD")
    throw new ContextError(
      "detached HEAD: check out the PR branch, or pass a PR number"
    );
  if (branch === "main")
    throw new ContextError(
      "on main: check out the PR branch, or pass a PR number"
    );
  const prs = JSON.parse(
    must(run, "gh", [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,title",
    ])
  );
  if (prs.length === 0)
    throw new ContextError(
      `no open PR for branch ${branch}: open one, or pass a number`
    );
  if (prs.length > 1) {
    throw new ContextError(
      `several open PRs for branch ${branch}: pass a number`,
      { candidates: prs }
    );
  }
  return prs[0].number;
}

/**
 * Gathers the review context. All I/O goes through `run`, so tests can feed fixtures.
 * @param {object} args
 * @param {Runner} args.run
 * @param {string} [args.prArg] - explicit PR number
 * @param {number} args.startedAt - epoch ms, echoed so the report can show elapsed time
 * @param {string} args.marker - random tag the skill uses to fence untrusted PR text
 * @returns {{context: object, artifacts: {diff: string, rules: object[], claudeMd: object[]}}}
 * @throws {ContextError} when the PR cannot be resolved or a required command fails
 */
export function collectContext({ run, prArg, startedAt, marker }) {
  const number = resolvePrNumber(run, prArg);
  const pr = JSON.parse(
    must(run, "gh", ["pr", "view", String(number), "--json", PR_FIELDS])
  );
  const warnings = [];
  if (prArg && pr.state !== "OPEN")
    warnings.push(
      `PR is ${pr.state}: reviewing it anyway because you named it.`
    );

  // Reviewers read the working tree, so it has to be the PR. A detached HEAD at
  // the PR head is fine; the PR branch at another commit only warns (below).
  const localHead = must(run, "git", ["rev-parse", "HEAD"]).trim();
  let localHeadMatchesPr = localHead === pr.headRefOid;
  if (!localHeadMatchesPr) {
    const branch = must(run, "git", [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]).trim();
    if (branch !== pr.headRefName) {
      throw new ContextError(
        `you are on ${branch}, not the PR branch ${pr.headRefName}: run gh pr checkout ${number} first`
      );
    }
    warnings.push(
      `Local HEAD ${localHead.slice(
        0,
        9
      )} is not the PR head ${pr.headRefOid.slice(
        0,
        9
      )}: reviewers read local files, so pull (or push) first for an exact review.`
    );
  }

  const files = must(run, "gh", [
    "api",
    "--paginate",
    `repos/{owner}/{repo}/pulls/${number}/files`,
    "--jq",
    ".[] | {path: .filename, additions, deletions, status}",
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .map((file) => ({ ...file, areas: classifyFile(file.path) }));
  const paths = files.map((file) => file.path);

  // At the PR head, uncommitted edits to the PR's own files still make the
  // working tree differ from the PR. Untracked files and edits to other files
  // do not affect what the reviewers read for this PR, so they are ignored.
  if (localHeadMatchesPr && paths.length > 0) {
    const edited = editedPrFiles(run, paths);
    if (edited.length > 0) {
      localHeadMatchesPr = false;
      const shown = edited.slice(0, 5).join(", ");
      const more = edited.length > 5 ? ` and ${edited.length - 5} more` : "";
      warnings.push(
        `Uncommitted edits to PR files (${shown}${more}): reviewers read local files, so commit or stash them first for an exact review.`
      );
    }
  }
  const base = `origin/${pr.baseRefName}`;

  // Rules and the fallback diff read the base branch, so refresh it first.
  // When the SSH remote fails (no agent in this shell), fetch the public repo
  // over HTTPS into the same ref. Failing both (offline) is not fatal.
  let fetched = run("git", ["fetch", "origin", pr.baseRefName], {
    env: NON_INTERACTIVE_GIT_ENV,
  });
  const httpsRepo = httpsRepoUrl(pr.url);
  if (fetched.code !== 0 && httpsRepo) {
    fetched = run(
      "git",
      [
        "fetch",
        httpsRepo,
        `+refs/heads/${pr.baseRefName}:refs/remotes/${base}`,
      ],
      { env: NON_INTERACTIVE_GIT_ENV }
    );
  }
  if (fetched.code !== 0) {
    const age = run("git", ["log", "-1", "--format=%cr", base]);
    const newest = age.code === 0 ? age.stdout.trim() : "unknown";
    warnings.push(
      `could not fetch ${base} (its newest local commit is from ${newest}); rules may be stale`
    );
  }

  // GitHub's diff is computed against the true merge base, so a stale local
  // main cannot inflate it. GitHub refuses very large diffs; then use git.
  let diff;
  let diffSource = "github";
  const ghDiff = run("gh", ["pr", "diff", String(number)]);
  if (ghDiff.code === 0) {
    diff = ghDiff.stdout;
  } else {
    const mergeBase = must(run, "git", [
      "merge-base",
      base,
      pr.headRefOid,
    ]).trim();
    diff = must(run, "git", ["diff", mergeBase, pr.headRefOid]);
    diffSource = "local";
    warnings.push(
      `GitHub refused the diff (${ghDiff.stderr.trim()}); using the local diff of the PR head against its merge base with ${base}.`
    );
  }

  // Rules come from the base branch so the PR cannot change what it is judged by.
  // Without the base ref there is no trusted copy, so the review runs without
  // rules rather than reading ones the PR may have written.
  let rulesRef = base;
  let rules = [];
  let claudeMd = [];
  const ruleListing = run("git", [
    "ls-tree",
    "-r",
    "--name-only",
    base,
    "--",
    ".claude/rules",
  ]);
  if (ruleListing.code !== 0) {
    rulesRef = null;
    warnings.push(
      `${base} not found locally: the review runs without project rules and CLAUDE.md, because the PR's own copies cannot be trusted. Fetch ${pr.baseRefName} and re-run for a full review.`
    );
  } else {
    const allRules = ruleListing.stdout
      .split("\n")
      .filter((p) => p.endsWith(".md"))
      .map((p) => {
        const content = must(run, "git", ["show", `${rulesRef}:${p}`]);
        return { path: p, content, ...parseRuleFrontmatter(content) };
      });
    rules = selectRules(allRules, paths);
    const tree = must(run, "git", ["ls-tree", "-r", "--name-only", rulesRef])
      .split("\n")
      .filter(Boolean);
    claudeMd = selectClaudeMdFiles(tree, paths).map((p) => ({
      path: p,
      content: must(run, "git", ["show", `${rulesRef}:${p}`]),
    }));
  }

  const selfModified = paths.some((p) => REVIEWER_PATH.test(p));
  if (selfModified) {
    warnings.push(
      "This PR changes the reviewer's own skill, agents, context script or CLAUDE.md: the review runs with those changes, so read them yourself."
    );
  }

  const areas = summarizeAreas(files);
  const countedFiles = files.filter((file) => isCounted(file.path)).length;
  const changedLines = countChangedLines(files);
  const tier = pickTier({ changedLines, fileCount: countedFiles, areas });

  const context = {
    startedAt,
    marker,
    pr: {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      state: pr.state,
      isDraft: pr.isDraft,
      isCrossRepository: pr.isCrossRepository === true,
      author: pr.author?.login ?? "",
      headRefName: pr.headRefName,
      headRefOid: pr.headRefOid,
      baseRefName: pr.baseRefName,
      labels: (pr.labels ?? []).map((label) => label.name),
      linkedIssues: (pr.closingIssuesReferences ?? []).map(
        (issue) => issue.url
      ),
      body: pr.body ?? "",
    },
    checks: summarizeChecks(pr.statusCheckRollup),
    diffSource,
    localHeadMatchesPr,
    stats: {
      files: files.length,
      countedFiles,
      changedLines,
      additions: files.reduce((sum, file) => sum + file.additions, 0),
      deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    },
    areas,
    tier,
    passes: pickPasses(tier, areas),
    files,
    rules: rules.map(({ path: rulePath, description }) => ({
      path: rulePath,
      description,
    })),
    claudeMd: claudeMd.map((file) => file.path),
    rulesRef,
    selfModified,
    warnings,
  };
  return { context, artifacts: { diff, rules, claudeMd } };
}

/**
 * Runs a real command synchronously.
 * @type {Runner}
 */
function realRun(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr || result.error?.message || "",
  };
}

/**
 * Where a review's artifacts go: `.pr-review/<pr>/` at the root of the current
 * worktree. Inside the worktree so read-only agents can open them; `.pr-review/`
 * is gitignored so they are never committed.
 * @param {Runner} run
 * @param {number} prNumber
 * @returns {string} absolute directory path
 * @throws {ContextError} when the worktree root cannot be resolved
 */
export function artifactDir(run, prNumber) {
  const root = must(run, "git", ["rev-parse", "--show-toplevel"]).trim();
  return path.join(root, ".pr-review", String(prNumber));
}

/**
 * CLI entry: collects the context, writes the diff and rule copies to
 * the directory from `artifactDir`, and prints the context with the artifact
 * paths added.
 */
function main() {
  try {
    const { context, artifacts } = collectContext({
      run: realRun,
      prArg: process.argv[2],
      startedAt: Date.now(),
      marker: `pr_${randomBytes(6).toString("hex")}`,
    });
    const outDir = artifactDir(realRun, context.pr.number);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(path.join(outDir, "rules"), { recursive: true });
    mkdirSync(path.join(outDir, "claude-md"), { recursive: true });

    const diffPath = path.join(outDir, "diff.patch");
    writeFileSync(diffPath, artifacts.diff);
    const rules = artifacts.rules.map((rule) => {
      const copyPath = path.join(outDir, "rules", flattenPath(rule.path));
      writeFileSync(copyPath, rule.content);
      return { path: rule.path, description: rule.description, copyPath };
    });
    const claudeMd = artifacts.claudeMd.map((file) => {
      const copyPath = path.join(outDir, "claude-md", flattenPath(file.path));
      writeFileSync(copyPath, file.content);
      return { path: file.path, copyPath };
    });

    const output = { ...context, outDir, diffPath, rules, claudeMd };
    writeFileSync(
      path.join(outDir, "context.json"),
      JSON.stringify(output, null, 2)
    );
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } catch (error) {
    if (!(error instanceof ContextError)) throw error;
    process.stdout.write(
      `${JSON.stringify({ error: error.message, ...error.extra })}\n`
    );
    process.exit(3);
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
)
  main();
