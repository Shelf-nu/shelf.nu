import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuditFindingsPage } from "~/modules/audit/findings.server";
import { AuditFindings } from "./audit-findings";
import { FINDINGS_REQUEST_TIMEOUT_MS } from "./audit-findings-helpers";

// why: DateS reads the user's date preferences from the root route's loader,
// and no router is running here. When a note was written is not under test.
vi.mock("~/components/shared/date", () => ({
  DateS: ({ date }: { date: Date | string }) => (
    <time>{new Date(date).toISOString()}</time>
  ),
}));

/**
 * Loading the next page of findings.
 *
 * Every way a "load more" request can go wrong must end in the list's own
 * retry footer. The list stays on screen with the rows it already holds; a
 * failure must never reach a route error boundary and replace the overview.
 *
 * @see {@link file://./audit-findings.tsx}
 */

/** A first page with one asset and a cursor to a second page. */
const FIRST_PAGE: AuditFindingsPage = {
  after: null,
  nextCursor: { title: "Camera", id: "aa-1" },
  hasMore: true,
  totalFindings: 2,
  findings: [{ assetId: "a1", assetName: "Camera", images: [], notes: [] }],
};

/** The JSON the endpoint answers for the second page. */
const SECOND_PAGE_JSON = {
  error: null,
  after: { title: "Camera", id: "aa-1" },
  nextCursor: null,
  hasMore: false,
  totalFindings: 2,
  findings: [
    {
      assetId: "a2",
      assetName: "Tripod",
      images: [],
      notes: [
        {
          id: "n1",
          content: "Leg is loose",
          createdAt: "2026-11-02T10:00:00.000Z",
          user: null,
        },
      ],
    },
  ],
};

function renderFindings() {
  return render(
    <AuditFindings
      auditId="audit-1"
      firstPage={FIRST_PAGE}
      auditWide={{ notes: [], images: [] }}
    />
  );
}

/** The footer button that requests the next page. */
const loadMoreButton = () => screen.getByRole("button", { name: /load more/i });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** A fetch that never answers, and rejects like a real one when aborted. */
function stalledFetch() {
  return vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      })
  );
}

describe("AuditFindings next page", () => {
  it("requests the page after the last row and appends it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(SECOND_PAGE_JSON), { status: 200 })
      );
    // why: the next page comes from the network; the request is the boundary.
    vi.stubGlobal("fetch", fetchMock);
    renderFindings();

    await userEvent.click(loadMoreButton());

    expect(await screen.findByText("Tripod")).toBeInTheDocument();
    expect(screen.getByText("Leg is loose")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/audits/audit-1/findings?afterTitle=Camera&afterId=aa-1"
    );
  });

  it.each([
    ["the request is rejected", () => Promise.reject(new TypeError("offline"))],
    [
      "the endpoint answers an error",
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify({ error: { message: "Something went wrong" } }),
            { status: 500 }
          )
        ),
    ],
  ])(
    "shows the retry footer and keeps the list when %s",
    async (_case, answer) => {
      // why: the next page comes from the network; the request is the boundary.
      vi.stubGlobal("fetch", vi.fn(answer));
      renderFindings();

      await userEvent.click(loadMoreButton());

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Could not load more findings."
        )
      );
      expect(
        screen.getByRole("button", { name: "Try again" })
      ).toBeInTheDocument();
      expect(screen.getByText("Camera")).toBeInTheDocument();
    }
  );

  it("gives up on a stalled request and offers a retry", async () => {
    vi.useFakeTimers();
    // why: the next page comes from the network; the request is the boundary.
    vi.stubGlobal("fetch", stalledFetch());
    renderFindings();

    fireEvent.click(loadMoreButton());
    expect(screen.getByText("Loading more findings")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(FINDINGS_REQUEST_TIMEOUT_MS);
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load more findings."
    );
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument();
  });

  it("loads the next page when the end of the list scrolls into view", async () => {
    let reportVisibility: IntersectionObserverCallback = () => {};
    // why: happy-dom has no layout, so nothing ever scrolls into view; the
    // stub hands the test the observer's callback to report it by hand.
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          reportVisibility = callback;
        }
        observe() {}
        disconnect() {}
      }
    );
    // why: the next page comes from the network; the request is the boundary.
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(SECOND_PAGE_JSON), { status: 200 })
        )
    );
    renderFindings();

    act(() => {
      reportVisibility(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
    });

    expect(await screen.findByText("Tripod")).toBeInTheDocument();
  });
});
