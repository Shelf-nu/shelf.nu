/**
 * Scan history sheet state
 *
 * The pages the sheet has loaded and what it is doing now, as one reducer so
 * a request, its answer and a reset are each a single transition. The first
 * page replaces the rows; every later page appends after them.
 *
 * @see {@link file://./scan-history-sheet.tsx}
 */
import type {
  ScanHistoryPage,
  ScanHistoryRow,
} from "~/modules/scan/history.server";

/** What the sheet has loaded and what it is doing. */
export type ScanHistoryState = {
  rows: ScanHistoryRow[];
  /** Where the next page starts, or null when there is none */
  nextCursor: string | null;
  phase: "idle" | "loading" | "loaded" | "failed";
  /** The cursor of the page in flight or last failed: null for the first */
  pendingCursor: string | null;
  errorMessage: string | null;
};

/** A transition of the sheet: a page request, its answer, a failure, or a reset. */
export type ScanHistoryAction =
  | { type: "request"; cursor: string | null }
  | { type: "receive"; page: ScanHistoryPage }
  | { type: "fail"; message: string }
  | { type: "reset" };

/** A closed sheet: nothing loaded, nothing in flight. */
export const INITIAL_SCAN_HISTORY_STATE: ScanHistoryState = {
  rows: [],
  nextCursor: null,
  phase: "idle",
  pendingCursor: null,
  errorMessage: null,
};

/**
 * Applies one transition to the sheet's state.
 *
 * @param state - The current state
 * @param action - What happened
 * @returns The next state
 */
export function scanHistoryReducer(
  state: ScanHistoryState,
  action: ScanHistoryAction
): ScanHistoryState {
  switch (action.type) {
    case "request":
      return {
        ...state,
        phase: "loading",
        pendingCursor: action.cursor,
        errorMessage: null,
      };
    case "receive":
      return {
        ...state,
        rows:
          state.pendingCursor === null
            ? action.page.scans
            : [...state.rows, ...action.page.scans],
        nextCursor: action.page.nextCursor,
        phase: "loaded",
      };
    case "fail":
      return { ...state, phase: "failed", errorMessage: action.message };
    case "reset":
      return INITIAL_SCAN_HISTORY_STATE;
  }
}
