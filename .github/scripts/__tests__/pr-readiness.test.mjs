/**
 * Tests for the PR readiness gate (.github/scripts/pr-readiness.mjs).
 *
 * The pure helpers are tested directly. `run()` is tested against a fake
 * GitHub client that records every call, so each test asserts what the gate
 * does on GitHub (statuses, reviews, removed requests) for a given PR state.
 *
 * Run with `pnpm test:tooling`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  BOT_LOGIN,
  RESOLVED_BODY,
  RESOLVED_MARKER,
  REVIEW_MARKER,
  STATUS_CONTEXT,
  buildReviewBody,
  codeSpan,
  collectOpenThreads,
  findOpenGateReviews,
  reviewerLabel,
  run,
} from "../pr-readiness.mjs";

/** Login of the PR author in every fixture. */
const PR_AUTHOR = "contributor";

/**
 * Builds a GraphQL review thread node. `bot` says whether the thread's opener
 * is a bot; `lastLogin` is who wrote the latest comment (the opener when
 * nobody has replied).
 */
function thread({
  resolved = false,
  outdated = false,
  path = "apps/webapp/app/components/assets/form.tsx",
  login = "coderabbitai",
  bot = true,
  lastLogin = login,
  url = "https://github.com/o/r/pull/1#discussion_r1",
} = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    path,
    comments: {
      nodes: [
        {
          author: login ? { login, __typename: bot ? "Bot" : "User" } : null,
          url,
        },
      ],
    },
    lastComment: {
      nodes: [{ author: lastLogin ? { login: lastLogin } : null }],
    },
  };
}

/**
 * Fake actions/github-script tools. `calls` records each mutating request as
 * [name, params] in order.
 */
function fakeTools({
  draft = false,
  threads = [],
  reviews = [],
  requested = { users: [{ login: "DonKoko" }], teams: [] },
  failOn = null,
} = {}) {
  const calls = [];
  const record = (name) => async (params) => {
    // why: simulates a GitHub API error on one call, to pin what a partial
    // failure leaves behind
    if (name === failOn) throw new Error(`${name} failed`);
    calls.push([name, params]);
    return { data: {} };
  };
  const listReviews = async () => ({ data: reviews });
  const github = {
    // why: the gate's only network dependency; a fake keeps the tests offline
    graphql: async () => ({
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: threads,
          },
        },
      },
    }),
    paginate: async (method) => (await method()).data,
    rest: {
      pulls: {
        listReviews,
        listRequestedReviewers: async () => ({ data: requested }),
        removeRequestedReviewers: record("removeRequestedReviewers"),
        createReview: record("createReview"),
        updateReview: record("updateReview"),
      },
      repos: { createCommitStatus: record("createCommitStatus") },
    },
  };
  const failures = [];
  const core = { info: () => {}, setFailed: (msg) => failures.push(msg) };
  const context = {
    serverUrl: "https://github.com",
    repo: { owner: "Shelf-nu", repo: "shelf.nu" },
    payload: {
      pull_request: {
        number: 3370,
        draft,
        head: { sha: "abc123" },
        user: { login: "contributor" },
      },
    },
  };
  return { tools: { github, context, core }, calls, failures };
}

/** A gate review that still lists open threads, as listReviews returns it. */
const gateReview = {
  id: 7,
  state: "COMMENTED",
  body: `${REVIEW_MARKER}\nold body`,
  user: { login: BOT_LOGIN },
};

describe("reviewerLabel", () => {
  it("names the review bots and keeps other logins plain", () => {
    assert.equal(reviewerLabel("coderabbitai"), "CodeRabbit");
    assert.equal(reviewerLabel("chatgpt-codex-connector"), "Codex");
    assert.equal(reviewerLabel("copilot-pull-request-reviewer"), "Copilot");
    assert.equal(reviewerLabel("someone"), "someone");
    assert.equal(reviewerLabel(undefined), "a deleted user");
  });
});

describe("collectOpenThreads", () => {
  it("keeps unresolved threads, including outdated ones", () => {
    const open = collectOpenThreads(
      [
        thread({ resolved: true }),
        thread({ login: "chatgpt-codex-connector" }),
        thread({ outdated: true, path: null }),
      ],
      PR_AUTHOR
    );
    assert.deepEqual(open, [
      {
        path: "apps/webapp/app/components/assets/form.tsx",
        reviewer: "Codex",
        url: "https://github.com/o/r/pull/1#discussion_r1",
        outdated: false,
        awaitingReply: false,
      },
      {
        path: "",
        reviewer: "CodeRabbit",
        url: "https://github.com/o/r/pull/1#discussion_r1",
        outdated: true,
        awaitingReply: false,
      },
    ]);
  });

  it("blocks on a bot thread even after the author replied", () => {
    const open = collectOpenThreads(
      [thread({ lastLogin: PR_AUTHOR })],
      PR_AUTHOR
    );
    assert.equal(open.length, 1);
  });

  it("blocks on a reviewer's thread only until the author replies", () => {
    const unanswered = thread({ login: "DonKoko", bot: false });
    const answered = thread({
      login: "DonKoko",
      bot: false,
      lastLogin: PR_AUTHOR,
    });
    const reopened = thread({
      login: "DonKoko",
      bot: false,
      lastLogin: "DonKoko",
    });
    const open = collectOpenThreads(
      [unanswered, answered, reopened],
      PR_AUTHOR
    );
    assert.equal(open.length, 2);
    assert.ok(open.every((t) => t.awaitingReply && t.reviewer === "DonKoko"));
  });
});

describe("codeSpan", () => {
  it("wraps a plain path in a single-backtick span", () => {
    assert.equal(codeSpan("apps/x.ts"), "` apps/x.ts `");
  });

  it("cannot be broken out of by backticks or line breaks in the path", () => {
    const hostile = "a`b``\n@someone [x](http://e)";
    const span = codeSpan(hostile);
    assert.ok(span.startsWith("``` ") && span.endsWith(" ```"));
    assert.ok(!span.includes("\n"));
    // The fence is longer than any backtick run inside, so the span only
    // closes at its own end.
    const inner = span.slice(4, -4);
    assert.ok(!inner.includes("```"));
  });
});

describe("buildReviewBody", () => {
  it("mentions the author, lists each thread and links the process", () => {
    const body = buildReviewBody({
      author: "contributor",
      repoUrl: "https://github.com/Shelf-nu/shelf.nu",
      threads: collectOpenThreads(
        [
          thread({ login: "chatgpt-codex-connector" }),
          thread({ outdated: true, path: null }),
          thread({ login: "DonKoko", bot: false, path: "README.md" }),
        ],
        PR_AUTHOR
      ),
    });
    assert.ok(body.startsWith(REVIEW_MARKER));
    assert.match(
      body,
      /@contributor this PR still has 3 open review threads to handle/
    );
    assert.match(
      body,
      /- ` apps\/webapp\/app\/components\/assets\/form.tsx `, from Codex: \[view thread\]/
    );
    assert.match(body, /- General comment, from CodeRabbit \(outdated\)/);
    assert.match(body, /- ` README.md `, from DonKoko \(awaiting your reply\)/);
    assert.match(
      body,
      /https:\/\/github.com\/Shelf-nu\/shelf.nu\/blob\/main\/CONTRIBUTING.md#the-pull-request-process/
    );
    // Thread authors are named, never @mentioned: only the PR author is notified.
    assert.equal(body.match(/@/g).length, 1);
  });

  it("uses the singular for one thread", () => {
    const body = buildReviewBody({
      author: "a",
      repoUrl: "https://github.com/o/r",
      threads: collectOpenThreads([thread()], PR_AUTHOR),
    });
    assert.match(body, /1 open review thread to handle,/);
  });
});

describe("findOpenGateReviews", () => {
  it("returns only the bot's own gate reviews not yet marked resolved", () => {
    const reviews = [
      gateReview,
      { ...gateReview, id: 8, body: RESOLVED_BODY },
      { ...gateReview, id: 9, body: "no marker" },
      { ...gateReview, id: 10, user: { login: "DonKoko" } },
    ];
    assert.deepEqual(
      findOpenGateReviews(reviews).map((r) => r.id),
      [7]
    );
  });
});

describe("run", () => {
  it("does nothing on a draft PR", async () => {
    const { tools, calls, failures } = fakeTools({
      draft: true,
      threads: [thread()],
    });
    await run(tools);
    assert.deepEqual(calls, []);
    assert.deepEqual(failures, []);
  });

  it("with open threads: fails the status, posts a comment review, removes requests", async () => {
    const { tools, calls, failures } = fakeTools({
      threads: [thread(), thread({ resolved: true })],
      requested: { users: [{ login: "DonKoko" }], teams: [{ slug: "core" }] },
    });
    await run(tools);

    assert.deepEqual(
      calls.map(([name]) => name),
      ["createCommitStatus", "createReview", "removeRequestedReviewers"]
    );
    assert.equal(calls[0][1].state, "failure");
    assert.equal(calls[0][1].sha, "abc123");
    assert.equal(calls[0][1].context, STATUS_CONTEXT);
    // A comment review, never REQUEST_CHANGES: the bot cannot dismiss a
    // verdict on main, so one would block the merge for good.
    assert.equal(calls[1][1].event, "COMMENT");
    assert.match(calls[1][1].body, /@contributor/);
    assert.deepEqual(calls[2][1].reviewers, ["DonKoko"]);
    assert.deepEqual(calls[2][1].team_reviewers, ["core"]);
    assert.equal(failures.length, 1);
  });

  it("when posting the review fails: the PR stays marked failed and keeps its request", async () => {
    const { tools, calls } = fakeTools({
      threads: [thread()],
      failOn: "createReview",
    });
    await assert.rejects(run(tools), /createReview failed/);
    // The request is still pending, so a re-run repeats the whole sequence
    // and the author is still notified.
    assert.deepEqual(
      calls.map(([name]) => name),
      ["createCommitStatus"]
    );
    assert.equal(calls[0][1].state, "failure");
  });

  it("with open threads and an earlier gate review: posts a new one so the author is notified", async () => {
    const { tools, calls } = fakeTools({
      threads: [thread()],
      reviews: [gateReview],
    });
    await run(tools);
    const names = calls.map(([name]) => name);
    assert.ok(names.includes("createReview"));
    assert.ok(!names.includes("updateReview"));
  });

  it("with open threads and no pending requests left: fails without a duplicate review", async () => {
    const { tools, calls, failures } = fakeTools({
      threads: [thread()],
      requested: { users: [], teams: [] },
    });
    await run(tools);
    assert.deepEqual(
      calls.map(([name]) => name),
      ["createCommitStatus"]
    );
    assert.equal(calls[0][1].state, "failure");
    assert.equal(failures.length, 1);
  });

  it("with every thread resolved: marks its open reviews resolved, passes, keeps the request", async () => {
    const { tools, calls, failures } = fakeTools({
      threads: [thread({ resolved: true })],
      reviews: [gateReview, { ...gateReview, id: 8, body: RESOLVED_BODY }],
    });
    await run(tools);

    assert.deepEqual(
      calls.map(([name]) => name),
      ["updateReview", "createCommitStatus"]
    );
    assert.equal(calls[0][1].review_id, 7);
    assert.match(calls[0][1].body, new RegExp(RESOLVED_MARKER));
    assert.equal(calls[1][1].state, "success");
    assert.deepEqual(failures, []);
  });
});
