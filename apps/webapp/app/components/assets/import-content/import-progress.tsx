/**
 * @file Progress view of a background asset import.
 *
 * `useAssetImportStatus` polls the status endpoint while an import is queued
 * or running and the tab is visible. `ImportProgress` renders the status:
 * waiting, a progress bar with the current phase, the finished summary with
 * its warnings, or the failure with a resume button.
 *
 * @see {@link file://./../../../routes/api+/asset-imports.$importId.ts} Polled endpoint
 * @see {@link file://./../../../routes/_layout+/assets.import_.$importId.tsx} Page and resume action
 * @see {@link file://./../../../modules/asset-import/types.ts} Payload types
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import useApiQuery from "~/hooks/use-api-query";
import { useDisabled } from "~/hooks/use-disabled";
import { useInterval } from "~/hooks/use-interval";
import { ASSET_IMPORT_POLL_INTERVAL_SECONDS } from "~/modules/asset-import/constants";
import type {
  AssetImportStatusPayload,
  ImportWarning,
} from "~/modules/asset-import/types";
import { Button } from "../../shared/button";
import { ImportRowErrorsTable } from "../../shared/import-row-errors-table";
import { Progress } from "../../shared/progress";

/** Statuses during which the import still moves and the page keeps polling. */
function isActiveStatus(status: AssetImportStatusPayload["status"]) {
  return status === "QUEUED" || status === "RUNNING";
}

/** Shape of the status endpoint's response. */
type StatusResponse = { import?: AssetImportStatusPayload };

/**
 * Keeps an import's status current.
 *
 * Polls every `ASSET_IMPORT_POLL_INTERVAL_SECONDS` while the status is
 * `QUEUED` or `RUNNING` and the tab is visible, and refetches once as soon as
 * a hidden tab becomes visible again. Stops on `COMPLETED` and `FAILED`. A new
 * `initial` (the loader revalidated, e.g. after Resume) replaces what was
 * polled so far and polling restarts if the new status is active.
 *
 * @param importId - The import to follow
 * @param initial - Status from the page loader, used until the first poll answers
 * @returns The most recent status
 */
export function useAssetImportStatus(
  importId: string,
  initial: AssetImportStatusPayload
): AssetImportStatusPayload {
  // The polled value is tagged with the `initial` it was polled against, so a
  // newer loader payload wins over an older poll without an effect to reset it.
  const [polled, setPolled] = useState<{
    base: AssetImportStatusPayload;
    value: AssetImportStatusPayload;
  } | null>(null);
  const status = polled && polled.base === initial ? polled.value : initial;
  const active = isActiveStatus(status.status);
  const [visible, setVisible] = useState(true);

  const { refetch } = useApiQuery<StatusResponse>({
    api: `/api/asset-imports/${importId}`,
    enabled: active,
    onSuccess: (response) => {
      if (response.import) {
        setPolled({ base: initial, value: response.import });
      }
    },
  });

  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === "visible");
    sync();

    const onVisibilityChange = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      // The tab was not polling while hidden: catch up right away.
      if (isVisible && active) refetch();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
    // `refetch` is a new function every render; the listener only needs the
    // latest `active`, and re-binding on it is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useInterval(
    refetch,
    active && visible ? ASSET_IMPORT_POLL_INTERVAL_SECONDS : undefined
  );

  return status;
}

/**
 * Text of the live region. It changes only when the status or phase changes,
 * never on a row count update, so a screen reader announces transitions
 * without chattering on every poll.
 */
function announcement(status: AssetImportStatusPayload) {
  switch (status.status) {
    case "QUEUED":
      return "Waiting to start...";
    case "RUNNING":
      switch (status.phase) {
        case "PREPARE":
          return "Preparing categories, locations and tags";
        case "FINALIZE":
          return "Finishing up";
        default:
          return "Importing assets";
      }
    case "COMPLETED":
      return `${status.totalRows} assets imported`;
    case "FAILED":
      return status.errorMessage ?? "The import stopped.";
    default:
      return "";
  }
}

/** Props for {@link ImportProgress}. */
type ImportProgressProps = {
  /** The import to show. */
  importId: string;
  /** Status from the page loader. */
  initial: AssetImportStatusPayload;
  /** Stored warnings from the page loader, rendered once the import completed. */
  warnings: ImportWarning[];
};

/**
 * Renders the live status of one import.
 *
 * When the import reaches a terminal status during this visit the loader is
 * revalidated once so `warnings` (not part of the polled payload) is current.
 *
 * @param props - See {@link ImportProgressProps}
 * @returns The status view for the current import status
 */
export function ImportProgress({
  importId,
  initial,
  warnings,
}: ImportProgressProps) {
  const status = useAssetImportStatus(importId, initial);
  const { revalidate } = useRevalidator();
  const resumeFetcher = useFetcher<{ error?: { message?: string } | null }>();
  const resuming = useDisabled(resumeFetcher);

  const previousStatus = useRef(status.status);
  useEffect(() => {
    if (
      isActiveStatus(previousStatus.current) &&
      !isActiveStatus(status.status)
    ) {
      void revalidate();
    }
    previousStatus.current = status.status;
  }, [status.status, revalidate]);

  const percent =
    status.totalRows > 0
      ? Math.round((status.processedRows / status.totalRows) * 100)
      : 0;

  return (
    <div className="mx-auto w-full max-w-screen-sm text-left">
      <h3>{status.fileName ?? "Asset import"}</h3>

      {/* One region, always mounted, so its text changes are announced. */}
      <p
        aria-live="polite"
        className={
          status.status === "FAILED"
            ? "mt-4 text-red-600"
            : status.status === "COMPLETED"
            ? "mt-4 font-medium text-green-700"
            : "mt-4"
        }
      >
        {announcement(status)}
      </p>

      {status.status === "QUEUED" ? (
        <div>
          <Progress className="mt-2" value={0} aria-label="Import progress" />
        </div>
      ) : null}

      {status.status === "RUNNING" ? (
        <div>
          <Progress
            className="mt-2"
            value={percent}
            aria-label="Import progress"
          />
          <p className="mt-2 text-sm text-gray-700">
            Imported {status.processedRows} of {status.totalRows} assets
          </p>
          <p className="mt-2 text-sm text-gray-600">
            You can leave this page. We will email you when it is done.
          </p>
        </div>
      ) : null}

      {status.status === "COMPLETED" ? (
        <div>
          <div className="mt-4 flex gap-3">
            <Button to="/assets">View assets</Button>
            <Button to="/assets/import" variant="secondary">
              Import another file
            </Button>
          </div>
          {status.warningCount > 0 ? (
            <div className="mt-6">
              <h4>Warnings</h4>
              <p className="text-sm text-gray-600">
                {status.warningCount} rows were imported with a warning
              </p>
              <ImportRowErrorsTable
                rowErrors={warnings}
                totalRowErrors={status.warningCount}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {status.status === "FAILED" ? (
        <div>
          <p className="mt-1 text-sm text-gray-600">
            Imported {status.processedRows} of {status.totalRows} before it
            stopped.
          </p>
          {resumeFetcher.data?.error ? (
            <p className="mt-2 text-sm text-red-600">
              {resumeFetcher.data.error.message}
            </p>
          ) : null}
          <resumeFetcher.Form method="post" className="mt-4">
            <input type="hidden" name="intent" value="resume" />
            <Button type="submit" disabled={resuming}>
              {resuming ? "Resuming..." : "Resume import"}
            </Button>
          </resumeFetcher.Form>
        </div>
      ) : null}
    </div>
  );
}
