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
  FindingsCursor,
} from "~/modules/audit/findings.server";

/** The findings loaded so far, and where the next page starts. */
export type FindingsListState = {
  findings: AssetFinding[];
  /** Where the next request starts; null once the last page is in. */
  nextCursor: FindingsCursor | null;
  hasMore: boolean;
  totalFindings: number;
};

/** A page arrived from the server. */
export type FindingsListAction = {
  type: "page_loaded";
  page: AuditFindingsPage;
};

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
  };
}

/**
 * Appends a fetched page to the list.
 *
 * Only a page read after the list's current cursor is taken, so a repeated
 * or out-of-order response cannot duplicate or skip rows. Assets already
 * listed are dropped as a safety net.
 *
 * @param state - The list so far
 * @param action - The page that arrived
 * @returns The list with the page appended
 */
export function findingsListReducer(
  state: FindingsListState,
  action: FindingsListAction
): FindingsListState {
  switch (action.type) {
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
 * Covers every note and photo on the page (ids, note text and photo
 * descriptions), so a finding added, edited or removed on a listed asset
 * changes it, and the total, so a finding on a later asset does too.
 *
 * @param page - The first page of asset findings
 * @returns A short stable hash of those contents
 */
export function findingsListKey(page: AuditFindingsPage) {
  const contents = JSON.stringify([
    page.totalFindings,
    page.findings.map((f) => [
      f.assetId,
      f.notes.map((n) => [n.id, n.content]),
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
 * @param photoCount - Photos recorded against the asset
 * @param noteCount - Condition notes recorded against the asset
 * @returns e.g. "2 photos · 1 note", or "" when both are zero
 */
export function findingSummary(photoCount: number, noteCount: number) {
  const parts: string[] = [];
  if (photoCount > 0) {
    parts.push(`${photoCount} ${photoCount === 1 ? "photo" : "photos"}`);
  }
  if (noteCount > 0) {
    parts.push(`${noteCount} ${noteCount === 1 ? "note" : "notes"}`);
  }
  return parts.join(" · ");
}
