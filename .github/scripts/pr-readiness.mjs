/**
 * PR readiness gate.
 *
 * Runs when a review is requested on a pull request (the "this is ready"
 * signal in CONTRIBUTING.md, "The pull request process"). If the PR still has
 * unresolved review threads, the request is premature: the gate removes every
 * pending review request, so the PR leaves the maintainer review queue, posts a
 * "Changes requested" review that mentions the author and lists the open
 * threads, and marks the `PR readiness` commit status as failed. When every
 * thread is resolved, it marks the status as passed and dismisses its own
 * earlier review, leaving the review request in place.
 *
 * Invoked from `.github/workflows/pr-readiness.yml` through
 * `actions/github-script`, which supplies the authenticated `github` client,
 * the event `context` and `core`. The pure helpers are exported for
 * `.github/scripts/__tests__/pr-readiness.test.mjs`.
 *
 * @see {@link file://./../workflows/pr-readiness.yml}
 * @see {@link file://./../../CONTRIBUTING.md}
 */

/** Hidden marker that identifies this gate's own reviews on a PR. */
export const REVIEW_MARKER = "<!-- pr-readiness-gate -->";

/** Context name of the commit status the gate sets on the PR head commit. */
export const STATUS_CONTEXT = "PR readiness";

/** Login of the account that `GITHUB_TOKEN` acts as. */
export const BOT_LOGIN = "github-actions[bot]";

/** Message used when dismissing the gate's review once threads are resolved. */
export const DISMISS_MESSAGE =
  "All review threads are resolved. The PR is ready for review.";

/**
 * Display names for the review bots. Logins are as GraphQL reports them
 * (without the `[bot]` suffix). Anyone not listed is shown by plain login,
 * never as an `@mention`, so listing a thread does not notify its author.
 */
const REVIEWER_NAMES = {
  coderabbitai: "CodeRabbit",
  "chatgpt-codex-connector": "Codex",
  "copilot-pull-request-reviewer": "Copilot",
};

/**
 * A review thread as returned by the GraphQL query in {@link fetchReviewThreads}.
 *
 * @typedef {object} ReviewThreadNode
 * @property {boolean} isResolved
 * @property {boolean} isOutdated
 * @property {string | null} path
 * @property {{ nodes: Array<{ author: { login: string } | null, url: string }> }} comments
 */

/**
 * An unresolved thread, reduced to what the review body lists.
 *
 * @typedef {object} OpenThread
 * @property {string} path - File the thread is on, or "" when GitHub has none
 * @property {string} reviewer - Display name of whoever opened the thread
 * @property {string} url - Link to the thread's first comment
 * @property {boolean} outdated - The commented code has changed since
 */

/**
 * Returns the display name for the reviewer who opened a thread.
 *
 * @param {string | undefined} login - GraphQL author login, absent for deleted users
 * @returns {string} A bot's product name, the plain login, or "a deleted user"
 */
export function reviewerLabel(login) {
  if (!login) return "a deleted user";
  return REVIEWER_NAMES[login] ?? login;
}

/**
 * Picks the unresolved threads out of a PR's review threads. Outdated threads
 * count: the process asks for every thread to be fixed or answered and then
 * resolved, and an outdated thread that is still open has not been.
 *
 * @param {ReviewThreadNode[]} nodes - Every review thread on the PR
 * @returns {OpenThread[]} The unresolved ones, in GitHub's order
 */
export function collectOpenThreads(nodes) {
  return nodes
    .filter((thread) => !thread.isResolved)
    .map((thread) => {
      const first = thread.comments.nodes[0];
      return {
        path: thread.path ?? "",
        reviewer: reviewerLabel(first?.author?.login),
        url: first?.url ?? "",
        outdated: thread.isOutdated,
      };
    });
}

/**
 * Builds the body of the "Changes requested" review.
 *
 * @param {object} args
 * @param {string} args.author - Login of the PR author, mentioned so they are notified
 * @param {OpenThread[]} args.threads - The unresolved threads (at least one)
 * @param {string} args.repoUrl - e.g. "https://github.com/Shelf-nu/shelf.nu"
 * @returns {string} Markdown body, starting with {@link REVIEW_MARKER}
 */
export function buildReviewBody({ author, threads, repoUrl }) {
  const count = threads.length;
  const noun = count === 1 ? "thread" : "threads";
  const lines = threads.map((thread) => {
    const where = thread.path ? `\`${thread.path}\`` : "General comment";
    const outdated = thread.outdated ? " (outdated)" : "";
    const link = thread.url ? `: [view thread](${thread.url})` : "";
    return `- ${where}, from ${thread.reviewer}${outdated}${link}`;
  });

  return [
    REVIEW_MARKER,
    `@${author} this PR still has ${count} unresolved review ${noun}, so the review request was removed.`,
    "",
    ...lines,
    "",
    "Fix or answer each one and resolve it, then request a review again. " +
      "Requesting the review runs this check again. See " +
      `[The pull request process](${repoUrl}/blob/main/CONTRIBUTING.md#the-pull-request-process).`,
  ].join("\n");
}

/**
 * Finds the gate's own reviews that still request changes. Dismissed reviews
 * have state `DISMISSED`, so they drop out here.
 *
 * @param {Array<{ id: number, state: string, body?: string | null, user?: { login: string } | null }>} reviews
 * @returns {Array<{ id: number }>} The active gate reviews, oldest first
 */
export function findActiveGateReviews(reviews) {
  return reviews.filter(
    (review) =>
      review.user?.login === BOT_LOGIN &&
      review.state === "CHANGES_REQUESTED" &&
      (review.body ?? "").includes(REVIEW_MARKER)
  );
}

/** GraphQL query for one page of a PR's review threads. */
const THREADS_QUERY = `
  query ($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            isOutdated
            path
            comments(first: 1) { nodes { author { login } url } }
          }
        }
      }
    }
  }
`;

/**
 * Fetches every review thread on a PR, following pagination.
 *
 * @param {any} github - Octokit client from actions/github-script
 * @param {{ owner: string, repo: string, number: number }} pr
 * @returns {Promise<ReviewThreadNode[]>}
 */
async function fetchReviewThreads(github, { owner, repo, number }) {
  /** @type {ReviewThreadNode[]} */
  const threads = [];
  let cursor = null;
  do {
    const result = await github.graphql(THREADS_QUERY, {
      owner,
      repo,
      number,
      cursor,
    });
    const page = result.repository.pullRequest.reviewThreads;
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

/**
 * Entry point called by the workflow.
 *
 * @param {{ github: any, context: any, core: any }} tools - From actions/github-script
 * @returns {Promise<void>}
 * @throws When a GitHub API call fails; the job then fails with that error
 */
export async function run({ github, context, core }) {
  const pr = context.payload.pull_request;
  const { owner, repo } = context.repo;
  const number = pr.number;
  const headSha = pr.head.sha;

  // Drafts are work in progress by definition, so a review request on one is
  // left alone.
  if (pr.draft) {
    core.info("PR is a draft; nothing to check.");
    return;
  }

  const threads = collectOpenThreads(
    await fetchReviewThreads(github, { owner, repo, number })
  );
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: number,
    per_page: 100,
  });
  const gateReviews = findActiveGateReviews(reviews);

  if (threads.length === 0) {
    for (const review of gateReviews) {
      await github.rest.pulls.dismissReview({
        owner,
        repo,
        pull_number: number,
        review_id: review.id,
        message: DISMISS_MESSAGE,
      });
    }
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      state: "success",
      context: STATUS_CONTEXT,
      description: "All review threads are resolved",
    });
    core.info("All review threads are resolved.");
    return;
  }

  // Remove every pending request (people and teams), not only the one that
  // fired this run, so the PR leaves every reviewer's queue.
  const { data: requested } = await github.rest.pulls.listRequestedReviewers({
    owner,
    repo,
    pull_number: number,
  });
  const reviewers = requested.users.map((user) => user.login);
  const teamReviewers = requested.teams.map((team) => team.slug);
  if (reviewers.length > 0 || teamReviewers.length > 0) {
    await github.rest.pulls.removeRequestedReviewers({
      owner,
      repo,
      pull_number: number,
      reviewers,
      team_reviewers: teamReviewers,
    });
  }

  const body = buildReviewBody({
    author: pr.user.login,
    threads,
    repoUrl: `${context.serverUrl}/${owner}/${repo}`,
  });
  const latest = gateReviews.at(-1);
  if (latest) {
    // One gate review per PR: refresh the existing one instead of stacking a
    // new review on every premature request.
    await github.rest.pulls.updateReview({
      owner,
      repo,
      pull_number: number,
      review_id: latest.id,
      body,
    });
  } else {
    await github.rest.pulls.createReview({
      owner,
      repo,
      pull_number: number,
      event: "REQUEST_CHANGES",
      body,
    });
  }

  const noun = threads.length === 1 ? "thread" : "threads";
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state: "failure",
    context: STATUS_CONTEXT,
    description: `${threads.length} unresolved review ${noun}`,
  });
  core.setFailed(
    `${threads.length} unresolved review ${noun}; the review request was removed.`
  );
}
