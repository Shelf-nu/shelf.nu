/**
 * Audit findings helpers
 *
 * Pure pieces of the Findings list on the audit overview: the paging state
 * that accumulates pages fetched from the server, and the count line shown
 * beside each asset.
 *
 * @see {@link file://./audit-findings.tsx} The component that uses them
 * @see {@link file://./../../modules/audit/findings.server.ts} The page read
 */
import type {
  AssetFinding,
  AuditFindingsPage,
} from "~/modules/audit/findings.server";

/** The findings loaded so far, and where the next page starts. */
export type FindingsListState = {
  findings: AssetFinding[];
  /** The last page appended; the next request asks for `lastPage + 1`. */
  lastPage: number;
  hasMore: boolean;
  totalFindings: number;
};

/** A page arrived from the server. */
export type FindingsListAction = {
  type: "page_loaded";
  page: AuditFindingsPage;
};

/**
 * The list state for the page the overview loader sent.
 *
 * @param firstPage - Page 1, from the loader
 */
export function initFindingsList(
  firstPage: AuditFindingsPage
): FindingsListState {
  return {
    findings: firstPage.findings,
    lastPage: firstPage.page,
    hasMore: firstPage.hasMore,
    totalFindings: firstPage.totalFindings,
  };
}

/**
 * Appends a fetched page to the list.
 *
 * Only the page directly after the last one is taken, so a repeated or
 * out-of-order response cannot duplicate or skip rows. Assets already listed
 * are dropped: pages are offset-based, so a finding recorded on an asset that
 * sorts earlier shifts the next page by one and repeats its first row.
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
      if (page.page !== state.lastPage + 1) return state;

      const listed = new Set(state.findings.map((f) => f.assetId));
      return {
        findings: [
          ...state.findings,
          ...page.findings.filter((f) => !listed.has(f.assetId)),
        ],
        lastPage: page.page,
        hasMore: page.hasMore,
        totalFindings: page.totalFindings,
      };
    }
  }
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
