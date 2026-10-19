/**
 * Scan history sheet
 *
 * A "View all scans" button for the Last scan card that opens a side sheet
 * listing every recorded scan of one asset or kit, newest first, 25 at a
 * time. Loads when opened, never with the page, and starts over each time it
 * is opened.
 *
 * @see {@link file://./../../routes/api+/scans.ts} The endpoint
 * @see {@link file://./scan-history-state.ts} The page state
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "~/components/shared/sheet";
import { Spinner } from "~/components/shared/spinner";
import type {
  ScanHistoryPage,
  ScanHistoryRow,
} from "~/modules/scan/history.server";
import type { ScanTarget } from "~/modules/scan/service.server";
import {
  INITIAL_SCAN_HISTORY_STATE,
  scanHistoryReducer,
} from "./scan-history-state";

/** What the endpoint answers: a page, or an error. */
type ScanHistoryResponse =
  | (ScanHistoryPage & { error: null })
  | { error: { message: string } };

/** The endpoint URL for one page of the target's scans. */
function scanHistoryUrl(target: ScanTarget, cursor: string | null) {
  const search = new URLSearchParams(
    "assetId" in target ? { assetId: target.assetId } : { kitId: target.kitId }
  );
  if (cursor) {
    search.set("cursor", cursor);
  }
  return `/api/scans?${search.toString()}`;
}

/**
 * The "View all scans" button and the sheet it opens.
 *
 * @param props.target - The asset or kit whose scans to list
 * @param props.itemName - Its name, shown under the sheet's title
 */
export function ScanHistoryButton({
  target,
  itemName,
}: {
  target: ScanTarget;
  itemName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, dispatch] = useReducer(
    scanHistoryReducer,
    INITIAL_SCAN_HISTORY_STATE
  );
  const targetId = "assetId" in target ? target.assetId : target.kitId;
  const fetcher = useFetcher<ScanHistoryResponse>({
    key: `scan-history-${targetId}`,
  });
  /**
   * The response already on the fetcher when the current request started, so
   * a page left over from an earlier open or an earlier request is never taken
   * for the one in flight. A new `load` on the same fetcher key supersedes any
   * request still pending, so a response from an abandoned request cannot land
   * after it.
   */
  const dataAtRequestRef = useRef<unknown>(undefined);

  /** Starts loading the page that begins after `cursor`. */
  const requestPage = (cursor: string | null) => {
    dataAtRequestRef.current = fetcher.data;
    dispatch({ type: "request", cursor });
    void fetcher.load(scanHistoryUrl(target, cursor));
  };

  useEffect(() => {
    // Only a request in flight accepts an answer; a closed sheet is "idle".
    if (state.phase !== "loading" || fetcher.state !== "idle") {
      return;
    }
    const response = fetcher.data;
    if (!response || response === dataAtRequestRef.current) {
      return;
    }
    if (response.error) {
      dispatch({ type: "fail", message: response.error.message });
    } else {
      dispatch({ type: "receive", page: response });
    }
  }, [fetcher.state, fetcher.data, state.phase]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      requestPage(null);
    } else {
      dispatch({ type: "reset" });
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      {/* A real trigger, so Radix returns focus to it when the sheet closes
          and exposes aria-expanded / aria-controls. Opening goes through
          `onOpenChange`, which requests the first page. */}
      <SheetTrigger asChild>
        <Button type="button" variant="secondary" className="w-full">
          View all scans
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto bg-white sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Scan history</SheetTitle>
          <SheetDescription>{itemName}</SheetDescription>
        </SheetHeader>

        {state.phase === "loaded" && state.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-600">
            Not scanned yet
          </p>
        ) : (
          <ol className="mt-4 flex flex-col divide-y divide-gray-200">
            {state.rows.map((row) => (
              <ScanHistoryItem key={row.id} row={row} />
            ))}
          </ol>
        )}

        <div className="flex flex-col items-center gap-2 py-4">
          {state.phase === "loading" ? (
            <div role="status">
              <Spinner />
              <span className="sr-only">Loading</span>
            </div>
          ) : null}
          {state.phase === "failed" ? (
            <>
              <p role="alert" className="text-sm text-error-600">
                {state.errorMessage}
              </p>
              <Button
                type="button"
                variant="secondary"
                onClick={() => requestPage(state.pendingCursor)}
              >
                Try again
              </Button>
            </>
          ) : null}
          {state.phase === "loaded" && state.nextCursor ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => requestPage(state.nextCursor)}
            >
              Load more
            </Button>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One scan: when and how on the first line, the details below. */
function ScanHistoryItem({ row }: { row: ScanHistoryRow }) {
  return (
    <li className="flex flex-col gap-1 py-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-900">
          <DateS date={row.scannedAt} includeTime />
        </span>
        <span className="text-xs text-gray-600">{row.source}</span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-gray-600">
        <dt>Code</dt>
        <dd>{row.code}</dd>
        <dt>Scanned by</dt>
        <dd>{row.scannedBy}</dd>
        <dt>Location</dt>
        <dd>
          {row.coordinates ? (
            <a
              className="text-primary-700 underline"
              href={`https://www.google.com/maps/search/?api=1&query=${row.coordinates.latitude},${row.coordinates.longitude}`}
              target="_blank"
              rel="nofollow noopener noreferrer"
            >
              {row.coordinates.latitude}, {row.coordinates.longitude}
            </a>
          ) : (
            "No location"
          )}
        </dd>
        <dt>Device</dt>
        <dd>{row.device}</dd>
      </dl>
    </li>
  );
}
