/**
 * Audit findings helpers
 *
 * Pure pieces of the Findings list on the audit overview: the paging state
 * that accumulates pages fetched from the server, the key that resets it, and
 * the count line shown beside each asset.
 *
 * @see {@link file://./audit-findings.tsx} The component that uses them
 * @see {@link file://./../../modules/audit/findings.server.ts} The page read
 */
import type {
  AssetFinding,
  AuditFindingsPage,
  FindingNote,
  FindingsCursor,
} from "~/modules/audit/findings.server";

/**
 * How long a request for the next page may take before the list gives up on
 * it and offers "Try again". Without a limit a stalled request would keep
 * the spinner up, and the retry hidden, for as long as the browser waits.
 */
export const FINDINGS_REQUEST_TIMEOUT_MS = 20_000;

/** The findings loaded so far, and where the next page starts. */
export type FindingsListState = {
  findings: AssetFinding[];
  /** Where the next request starts; null once the last page is in. */
  nextCursor: FindingsCursor | null;
  hasMore: boolean;
  totalFindings: number;
  /** A request for the next page is in flight. */
  isLoading: boolean;
  /** The last request failed; loading resumes only on an explicit retry. */
  failed: boolean;
};

/** What happens to the list: a request starts, answers or fails. */
export type FindingsListAction =
  | { type: "request_started" }
  | { type: "page_loaded"; page: AuditFindingsPage }
  | { type: "request_failed" };

/**
 * The list state for the first page, which the overview loader sends.
 *
 * @param firstPage - The first page of asset findings
 */
export function initFindingsList(
  firstPage: AuditFindingsPage
): FindingsListState {
  return {
    findings: firstPage.findings,
    nextCursor: firstPage.nextCursor,
    hasMore: firstPage.hasMore,
    totalFindings: firstPage.totalFindings,
    isLoading: false,
    failed: false,
  };
}

/**
 * Moves the list through a request for its next page.
 *
 * A page is appended only when it was read after the list's current cursor,
 * so a repeated or out-of-order response cannot duplicate or skip rows.
 * Assets already listed are dropped as a safety net.
 *
 * @param state - The list so far
 * @param action - A request starting, answering or failing
 * @returns The next list state
 */
export function findingsListReducer(
  state: FindingsListState,
  action: FindingsListAction
): FindingsListState {
  switch (action.type) {
    case "request_started":
      return { ...state, isLoading: true, failed: false };
    case "request_failed":
      return { ...state, isLoading: false, failed: true };
    case "page_loaded": {
      const { page } = action;
      if (!sameCursor(page.after, state.nextCursor)) return state;

      const listed = new Set(state.findings.map((f) => f.assetId));
      return {
        findings: [
          ...state.findings,
          ...page.findings.filter((f) => !listed.has(f.assetId)),
        ],
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        totalFindings: page.totalFindings,
        isLoading: false,
        failed: false,
      };
    }
  }
}

/** Whether two cursors point at the same row; two nulls never match. */
function sameCursor(a: FindingsCursor | null, b: FindingsCursor | null) {
  return a !== null && b !== null && a.title === b.title && a.id === b.id;
}

/**
 * Identifies the contents of the first page, so the list remounts with fresh
 * data when they change and keeps the pages it has loaded when they do not.
 *
 * Covers every asset name and every note and photo on the page (ids, note
 * text, the names its author is shown by and photo descriptions), so
 * renaming a listed asset or a note's author, or adding, editing or removing
 * a finding, changes it, and the total, so a finding on a later asset does
 * too.
 *
 * @param page - The first page of asset findings
 * @returns A short stable hash of those contents
 */
export function findingsListKey(page: AuditFindingsPage) {
  const contents = JSON.stringify([
    page.totalFindings,
    page.findings.map((f) => [
      f.assetId,
      f.assetName,
      f.notes.map((n) => [
        n.id,
        n.content,
        n.user?.displayName,
        n.user?.firstName,
        n.user?.lastName,
      ]),
      f.images.map((i) => [i.id, i.description]),
    ]),
  ]);
  return hashString(contents);
}

/** 32-bit FNV-1a hash, as base 36. Identity only, not security. */
function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Short count line shown beside an asset in the Findings list.
 *
 * Notes come first because the row shows its notes above its photos; keep
 * the two in the same order.
 *
 * @param counts.notes - Condition notes recorded against the asset
 * @param counts.photos - Photos recorded against the asset
 * @returns e.g. "1 note · 2 photos", or "" when both are zero
 */
export function findingSummary({
  notes,
  photos,
}: {
  notes: number;
  photos: number;
}) {
  const parts: string[] = [];
  if (notes > 0) {
    parts.push(`${notes} ${notes === 1 ? "note" : "notes"}`);
  }
  if (photos > 0) {
    parts.push(`${photos} ${photos === 1 ? "photo" : "photos"}`);
  }
  return parts.join(" · ");
}

/**
 * A page of findings as JSON carries it: note dates arrive as ISO strings.
 */
export type SerializedFindingsPage = Omit<AuditFindingsPage, "findings"> & {
  findings: (Omit<AssetFinding, "notes"> & {
    notes: (Omit<FindingNote, "createdAt"> & { createdAt: string })[];
  })[];
};

/**
 * Turns a page read from the findings endpoint back into the shape the
 * loader sends, so every row renders from the same types.
 *
 * @param page - The JSON page
 * @returns The page with note dates as `Date`s
 */
export function reviveFindingsPage(
  page: SerializedFindingsPage
): AuditFindingsPage {
  return {
    ...page,
    findings: page.findings.map((finding) => ({
      ...finding,
      notes: finding.notes.map((note) => ({
        ...note,
        createdAt: new Date(note.createdAt),
      })),
    })),
  };
}
