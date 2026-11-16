/**
 * PR readiness gate.
 *
 * Runs when a review is requested on a pull request (the "this is ready"
 * signal in CONTRIBUTING.md, "The pull request process"). If the PR still has
 * blocking review threads (see {@link collectOpenThreads}), the request is
 * premature: the gate removes every
 * pending review request, so the PR leaves the maintainer review queue, posts a
 * comment review that mentions the author and lists the open threads, and
 * marks the `PR readiness` commit status as failed. When every thread is
 * resolved, it marks the status as passed and edits its own earlier reviews to
 * say so, leaving the review request in place.
 *
 * The gate's reviews are comment reviews, never "Changes requested": a
 * requested-changes verdict from the bot would block the merge, and branch
 * protection on `main` lets only admins dismiss reviews, so the bot could never
 * clear it. A comment review carries no verdict and the bot may edit its own.
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

/** Second marker, present once a gate review has been edited to "resolved". */
export const RESOLVED_MARKER = "<!-- pr-readiness-gate:resolved -->";

/** Body a gate review is edited to once every review thread is resolved. */
export const RESOLVED_BODY = [
  REVIEW_MARKER,
  RESOLVED_MARKER,
  "✅ No open review threads left to handle. The PR is ready for review.",
].join("\n");

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
 * @property {{ nodes: Array<{ author: { login: string, __typename: string } | null, url: string }> }} comments - The first comment
 * @property {{ nodes: Array<{ author: { login: string } | null }> }} lastComment - The most recent comment
 */

/**
 * An unresolved thread, reduced to what the review body lists.
 *
 * @typedef {object} OpenThread
 * @property {string} path - File the thread is on, or "" when GitHub has none
 * @property {string} reviewer - Display name of whoever opened the thread
 * @property {string} url - Link to the thread's first comment
 * @property {boolean} outdated - The commented code has changed since
 * @property {boolean} awaitingReply - A human reviewer's thread the PR author
 *   has not answered yet (bot threads are always false)
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
 * Picks the threads that block a review request, following CONTRIBUTING.md:
 *
 * - A thread opened by a bot (CodeRabbit, Codex, Copilot) blocks until it is
 *   resolved: bot threads are always resolved once fixed or answered.
 * - A thread opened by a person blocks only while the PR author has not
 *   replied to it, i.e. while the latest comment is not the author's. A
 *   contributor may leave a reviewer's thread open after replying with a
 *   question or a disagreement, and then re-request the review.
 *
 * Outdated threads count like any other: an outdated thread that is still
 * open has not been answered.
 *
 * @param {ReviewThreadNode[]} nodes - Every review thread on the PR
 * @param {string} prAuthor - Login of the PR author
 * @returns {OpenThread[]} The blocking threads, in GitHub's order
 */
export function collectOpenThreads(nodes, prAuthor) {
  return nodes
    .filter((thread) => !thread.isResolved)
    .map((thread) => {
      const first = thread.comments.nodes[0];
      const openedByBot = first?.author?.__typename === "Bot";
      const lastAuthor = thread.lastComment?.nodes[0]?.author?.login;
      return {
        path: thread.path ?? "",
        reviewer: reviewerLabel(first?.author?.login),
        url: first?.url ?? "",
        outdated: thread.isOutdated,
        awaitingReply: !openedByBot && lastAuthor !== prAuthor,
        blocking: openedByBot || lastAuthor !== prAuthor,
      };
    })
    .filter(({ blocking }) => blocking)
    .map(({ blocking: _blocking, ...thread }) => thread);
}

/**
 * Renders a file path as a Markdown code span that nothing in the path can
 * break out of. Paths come from the PR, so a name containing backticks or line
 * breaks could otherwise close the span and inject Markdown (including
 * `@mentions`) into a review posted by the Actions bot. The fence is one
 * backtick longer than the longest run inside the path, and line breaks become
 * spaces, since a code span cannot hold them.
 *
 * @param {string} path - Repo-relative file path, untrusted
 * @returns {string} A Markdown code span showing the path literally
 */
export function codeSpan(path) {
  const flat = path.replace(/[\r\n]+/g, " ");
  const longestRun = Math.max(
    0,
    ...(flat.match(/`+/g) ?? []).map((run) => run.length)
  );
  const fence = "`".repeat(longestRun + 1);
  return `${fence} ${flat} ${fence}`;
}

/**
 * Builds the body of the comment review posted when threads are still open.
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
    const where = thread.path ? codeSpan(thread.path) : "General comment";
    const notes = [
      thread.outdated && "outdated",
      thread.awaitingReply && "awaiting your reply",
    ].filter(Boolean);
    const note = notes.length > 0 ? ` (${notes.join(", ")})` : "";
    const link = thread.url ? `: [view thread](${thread.url})` : "";
    return `- ${where}, from ${thread.reviewer}${note}${link}`;
  });

  return [
    REVIEW_MARKER,
    `@${author} this PR still has ${count} open review ${noun} to handle, so the review request was removed.`,
    "",
    ...lines,
    "",
    "Fix or answer each bot thread and resolve it. Reply to each reviewer's " +
      "thread: fix it and resolve it, or answer with a question or a " +
      "disagreement and leave it open. Then request a review again. " +
      "Requesting the review runs this check again. See " +
      `[The pull request process](${repoUrl}/blob/main/CONTRIBUTING.md#the-pull-request-process).`,
  ].join("\n");
}

/**
 * Finds the gate's own reviews that still list open threads, that is, those
 * not yet edited to {@link RESOLVED_BODY}.
 *
 * @param {Array<{ id: number, body?: string | null, user?: { login: string } | null }>} reviews
 * @returns {Array<{ id: number }>} The unresolved gate reviews, oldest first
 */
export function findOpenGateReviews(reviews) {
  return reviews.filter((review) => {
    const body = review.body ?? "";
    return (
      review.user?.login === BOT_LOGIN &&
      body.includes(REVIEW_MARKER) &&
      !body.includes(RESOLVED_MARKER)
    );
  });
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
            comments(first: 1) { nodes { author { login __typename } url } }
            lastComment: comments(last: 1) { nodes { author { login } } }
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
    await fetchReviewThreads(github, { owner, repo, number }),
    pr.user.login
  );

  if (threads.length === 0) {
    const reviews = await github.paginate(github.rest.pulls.listReviews, {
      owner,
      repo,
      pull_number: number,
      per_page: 100,
    });
    for (const review of findOpenGateReviews(reviews)) {
      await github.rest.pulls.updateReview({
        owner,
        repo,
        pull_number: number,
        review_id: review.id,
        body: RESOLVED_BODY,
      });
    }
    await github.rest.repos.createCommitStatus({
      owner,
      repo,
      sha: headSha,
      state: "success",
      context: STATUS_CONTEXT,
      description: "No open review threads to handle",
    });
    core.info("All review threads are resolved.");
    return;
  }

  // Order matters when a call fails partway: the failure status goes first so
  // the PR is marked even if a later call errors, and the review is posted
  // before the requests are removed, so a re-run still finds the pending
  // request and repeats the whole sequence instead of skipping the notice.
  const noun = threads.length === 1 ? "thread" : "threads";
  await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha: headSha,
    state: "failure",
    context: STATUS_CONTEXT,
    description: `${threads.length} open review ${noun} to handle`,
  });

  // Every pending request (people and teams) is removed, not only the one that
  // fired this run, so the PR leaves every reviewer's queue.
  const { data: requested } = await github.rest.pulls.listRequestedReviewers({
    owner,
    repo,
    pull_number: number,
  });
  const reviewers = requested.users.map((user) => user.login);
  const teamReviewers = requested.teams.map((team) => team.slug);
  // No pending request left means an earlier run for this same request (several
  // reviewers requested at once fire one event each) already posted the review
  // and removed them; posting again would only duplicate it.
  if (reviewers.length > 0 || teamReviewers.length > 0) {
    // A new review on every premature request, never an edit of an old one:
    // GitHub notifies the author of a mention only when the text is posted,
    // not when an existing review is edited to include it.
    await github.rest.pulls.createReview({
      owner,
      repo,
      pull_number: number,
      event: "COMMENT",
      body: buildReviewBody({
        author: pr.user.login,
        threads,
        repoUrl: `${context.serverUrl}/${owner}/${repo}`,
      }),
    });

    await github.rest.pulls.removeRequestedReviewers({
      owner,
      repo,
      pull_number: number,
      reviewers,
      team_reviewers: teamReviewers,
    });
  }

  core.setFailed(`${threads.length} open review ${noun} to handle.`);
}
