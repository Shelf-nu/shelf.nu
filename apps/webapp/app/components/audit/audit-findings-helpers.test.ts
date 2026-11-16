import { describe, expect, it } from "vitest";
import type {
  AuditFindingsPage,
  FindingsCursor,
} from "~/modules/audit/findings.server";
import {
  findingSummary,
  findingsListKey,
  findingsListReducer,
  initFindingsList,
  reviveFindingsPage,
} from "./audit-findings-helpers";

/** The cursor pointing after the asset with this id. */
const cursorAt = (id: string): FindingsCursor => ({
  title: `Asset ${id}`,
  id: `aa-${id}`,
});

/** A page of findings holding one asset per id given, read after `after`. */
function page(
  after: FindingsCursor | null,
  assetIds: string[],
  { hasMore = true, totalFindings = 25 } = {}
): AuditFindingsPage {
  const lastId = assetIds.at(-1);
  return {
    after,
    nextCursor: hasMore && lastId ? cursorAt(lastId) : null,
    hasMore,
    totalFindings,
    findings: assetIds.map((assetId) => ({
      assetId,
      assetName: `Asset ${assetId}`,
      images: [],
      notes: [],
    })),
  };
}

const ids = (state: { findings: { assetId: string }[] }) =>
  state.findings.map((f) => f.assetId);

describe("findingsListReducer", () => {
  it("appends the page read after its cursor and takes the next cursor", () => {
    const state = findingsListReducer(
      initFindingsList(page(null, ["a", "b"])),
      {
        type: "page_loaded",
        page: page(cursorAt("b"), ["c"], { hasMore: false, totalFindings: 3 }),
      }
    );

    expect(ids(state)).toEqual(["a", "b", "c"]);
    expect(state).toMatchObject({
      nextCursor: null,
      hasMore: false,
      totalFindings: 3,
    });
  });

  it("ignores a page read after any other cursor", () => {
    const start = initFindingsList(page(null, ["a", "b"]));

    for (const after of [null, cursorAt("a"), cursorAt("z")]) {
      expect(
        findingsListReducer(start, {
          type: "page_loaded",
          page: page(after, ["x"]),
        })
      ).toBe(start);
    }
  });

  it("drops an asset that is already listed", () => {
    const state = findingsListReducer(
      initFindingsList(page(null, ["a", "b"])),
      { type: "page_loaded", page: page(cursorAt("b"), ["b", "c"]) }
    );

    expect(ids(state)).toEqual(["a", "b", "c"]);
  });
});

describe("findingsListReducer request state", () => {
  const start = initFindingsList(page(null, ["a"]));

  it("starts with nothing loading and nothing failed", () => {
    expect(start).toMatchObject({ isLoading: false, failed: false });
  });

  it("marks a request in flight and clears an earlier failure", () => {
    const failed = findingsListReducer(start, { type: "request_failed" });
    const started = findingsListReducer(failed, { type: "request_started" });

    expect(failed).toMatchObject({ isLoading: false, failed: true });
    expect(started).toMatchObject({ isLoading: true, failed: false });
  });

  it("ends the request when the page arrives", () => {
    const started = findingsListReducer(start, { type: "request_started" });
    const loaded = findingsListReducer(started, {
      type: "page_loaded",
      page: page(cursorAt("a"), ["b"]),
    });

    expect(loaded).toMatchObject({ isLoading: false, failed: false });
    expect(ids(loaded)).toEqual(["a", "b"]);
  });
});

describe("findingsListKey", () => {
  /** A first page with one asset carrying one note and one photo. */
  function firstPage({
    noteContent = "Scratched",
    description = null as string | null,
    totalFindings = 1,
    assetName = "Camera",
    authorName = "Sam Lee",
  } = {}): AuditFindingsPage {
    return {
      ...page(null, ["a"], { totalFindings }),
      findings: [
        {
          assetId: "a",
          assetName,
          notes: [
            {
              id: "n1",
              content: noteContent,
              createdAt: new Date("2026-11-01"),
              user: {
                displayName: authorName,
                firstName: "Sam",
                lastName: "Lee",
              },
            },
          ],
          images: [
            {
              id: "i1",
              imageUrl: "u",
              thumbnailUrl: null,
              description,
              capturedAt: null,
              captureSource: null,
              createdAt: new Date("2026-11-01"),
            },
          ],
        },
      ],
    };
  }

  it("stays the same for the same contents", () => {
    expect(findingsListKey(firstPage())).toBe(findingsListKey(firstPage()));
  });

  it("changes when a note, its author's name, a photo, an asset name or the total changes", () => {
    const key = findingsListKey(firstPage());

    expect(findingsListKey(firstPage({ noteContent: "Dented" }))).not.toBe(key);
    expect(findingsListKey(firstPage({ description: "Front" }))).not.toBe(key);
    expect(findingsListKey(firstPage({ totalFindings: 2 }))).not.toBe(key);
    expect(findingsListKey(firstPage({ assetName: "Camera 2" }))).not.toBe(key);
    expect(findingsListKey(firstPage({ authorName: "Sam L." }))).not.toBe(key);
  });
});

describe("findingSummary", () => {
  it("counts notes then photos, in the order the row shows them", () => {
    expect(findingSummary({ notes: 2, photos: 1 })).toBe("2 notes · 1 photo");
    expect(findingSummary({ notes: 1, photos: 3 })).toBe("1 note · 3 photos");
    expect(findingSummary({ notes: 0, photos: 3 })).toBe("3 photos");
    expect(findingSummary({ notes: 1, photos: 0 })).toBe("1 note");
  });
});

describe("reviveFindingsPage", () => {
  it("turns note and photo dates from the JSON page back into dates", () => {
    const page = reviveFindingsPage({
      after: null,
      nextCursor: null,
      hasMore: false,
      totalFindings: 1,
      findings: [
        {
          assetId: "a1",
          assetName: "Camera",
          notes: [],
          images: [
            {
              id: "i1",
              imageUrl: "u",
              thumbnailUrl: null,
              description: null,
              capturedAt: "2026-10-01T08:30:00.000Z",
              captureSource: "LIBRARY",
              createdAt: "2026-11-02T10:00:00.000Z",
            },
            {
              id: "i2",
              imageUrl: "u",
              thumbnailUrl: null,
              description: null,
              capturedAt: null,
              captureSource: null,
              createdAt: "2026-11-02T10:00:00.000Z",
            },
          ],
        },
      ],
    });

    const [taken, undated] = page.findings[0].images;
    expect(taken.capturedAt).toEqual(new Date("2026-10-01T08:30:00.000Z"));
    expect(taken.createdAt).toEqual(new Date("2026-11-02T10:00:00.000Z"));
    expect(undated.capturedAt).toBeNull();
  });
});
