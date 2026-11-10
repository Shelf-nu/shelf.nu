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
  DISMISS_MESSAGE,
  REVIEW_MARKER,
  STATUS_CONTEXT,
  buildReviewBody,
  collectOpenThreads,
  findActiveGateReviews,
  reviewerLabel,
  run,
} from "../pr-readiness.mjs";

/** Builds a GraphQL review thread node. */
function thread({
  resolved = false,
  outdated = false,
  path = "apps/webapp/app/components/assets/form.tsx",
  login = "coderabbitai",
  url = "https://github.com/o/r/pull/1#discussion_r1",
} = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    path,
    comments: { nodes: [{ author: login ? { login } : null, url }] },
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
} = {}) {
  const calls = [];
  const record = (name) => async (params) => {
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
        dismissReview: record("dismissReview"),
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

/** An active gate review, as listReviews returns it. */
const gateReview = {
  id: 7,
  state: "CHANGES_REQUESTED",
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
    const open = collectOpenThreads([
      thread({ resolved: true }),
      thread({ login: "chatgpt-codex-connector" }),
      thread({ outdated: true, path: null }),
    ]);
    assert.deepEqual(open, [
      {
        path: "apps/webapp/app/components/assets/form.tsx",
        reviewer: "Codex",
        url: "https://github.com/o/r/pull/1#discussion_r1",
        outdated: false,
      },
      {
        path: "",
        reviewer: "CodeRabbit",
        url: "https://github.com/o/r/pull/1#discussion_r1",
        outdated: true,
      },
    ]);
  });
});

describe("buildReviewBody", () => {
  it("mentions the author, lists each thread and links the process", () => {
    const body = buildReviewBody({
      author: "contributor",
      repoUrl: "https://github.com/Shelf-nu/shelf.nu",
      threads: collectOpenThreads([
        thread({ login: "chatgpt-codex-connector" }),
        thread({ outdated: true, path: null }),
      ]),
    });
    assert.ok(body.startsWith(REVIEW_MARKER));
    assert.match(
      body,
      /@contributor this PR still has 2 unresolved review threads/
    );
    assert.match(
      body,
      /- `apps\/webapp\/app\/components\/assets\/form.tsx`, from Codex: \[view thread\]/
    );
    assert.match(body, /- General comment, from CodeRabbit \(outdated\)/);
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
      threads: collectOpenThreads([thread()]),
    });
    assert.match(body, /1 unresolved review thread,/);
  });
});

describe("findActiveGateReviews", () => {
  it("returns only the bot's own reviews that still request changes", () => {
    const reviews = [
      gateReview,
      { ...gateReview, id: 8, state: "DISMISSED" },
      { ...gateReview, id: 9, body: "no marker" },
      { ...gateReview, id: 10, user: { login: "DonKoko" } },
    ];
    assert.deepEqual(
      findActiveGateReviews(reviews).map((r) => r.id),
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

  it("with open threads: removes requests, requests changes, fails the status", async () => {
    const { tools, calls, failures } = fakeTools({
      threads: [thread(), thread({ resolved: true })],
      requested: { users: [{ login: "DonKoko" }], teams: [{ slug: "core" }] },
    });
    await run(tools);

    assert.deepEqual(
      calls.map(([name]) => name),
      ["removeRequestedReviewers", "createReview", "createCommitStatus"]
    );
    assert.deepEqual(calls[0][1].reviewers, ["DonKoko"]);
    assert.deepEqual(calls[0][1].team_reviewers, ["core"]);
    assert.equal(calls[1][1].event, "REQUEST_CHANGES");
    assert.match(calls[1][1].body, /@contributor/);
    assert.equal(calls[2][1].state, "failure");
    assert.equal(calls[2][1].sha, "abc123");
    assert.equal(calls[2][1].context, STATUS_CONTEXT);
    assert.equal(failures.length, 1);
  });

  it("with open threads and an earlier gate review: updates it instead of adding one", async () => {
    const { tools, calls } = fakeTools({
      threads: [thread()],
      reviews: [gateReview],
    });
    await run(tools);
    const names = calls.map(([name]) => name);
    assert.ok(names.includes("updateReview"));
    assert.ok(!names.includes("createReview"));
    assert.equal(calls.find(([n]) => n === "updateReview")[1].review_id, 7);
  });

  it("with open threads and no pending requests: skips the removal call", async () => {
    const { tools, calls } = fakeTools({
      threads: [thread()],
      requested: { users: [], teams: [] },
    });
    await run(tools);
    assert.ok(!calls.some(([name]) => name === "removeRequestedReviewers"));
  });

  it("with every thread resolved: dismisses its review, passes, keeps the request", async () => {
    const { tools, calls, failures } = fakeTools({
      threads: [thread({ resolved: true })],
      reviews: [gateReview],
    });
    await run(tools);

    assert.deepEqual(
      calls.map(([name]) => name),
      ["dismissReview", "createCommitStatus"]
    );
    assert.equal(calls[0][1].review_id, 7);
    assert.equal(calls[0][1].message, DISMISS_MESSAGE);
    assert.equal(calls[1][1].state, "success");
    assert.deepEqual(failures, []);
  });
});
