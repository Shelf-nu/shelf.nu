import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { Spinner } from "~/components/shared/spinner";
import type { action } from "~/routes/api+/generate-sequential-ids";

interface SequentialIdMigrationModalProps {
  /** Active organization id. Parent should pass this as `key` to remount the
   *  modal (and reset its state) when the active organization changes. */
  organizationId: string;
}

type MigrationState = "starting" | "running" | "completed" | "error";

/** Combined migration state — keeps the status and user-facing message in a
 *  single atom so they cannot drift and we avoid cascading setState calls. */
type MigrationStatus = {
  state: MigrationState;
  message: string;
};

const INITIAL_STATUS: MigrationStatus = {
  state: "starting",
  message: "Setting up sequential IDs for your organization...",
};

export function SequentialIdMigrationModal(
  // `organizationId` is consumed by the parent as `key` to remount this modal
  // when the organization changes; no internal read is required.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _: SequentialIdMigrationModalProps
) {
  const fetcher = useFetcher<typeof action>();
  // Status is stored as a single object so each transition is one setState.
  const [status, setStatus] = useState<MigrationStatus>(INITIAL_STATUS);

  // Auto-start migration when modal opens
  useEffect(() => {
    if (status.state === "starting") {
      setStatus({
        state: "running",
        message: "Setting up sequential IDs for your organization...",
      });
      void fetcher.submit(
        {},
        { action: "/api/generate-sequential-ids", method: "post" }
      );
    }
  }, [status.state, fetcher]);

  // Handle fetcher response — single setState per branch avoids cascading updates.
  useEffect(() => {
    if (!fetcher.data) return;
    if ("success" in fetcher.data && fetcher.data.success) {
      // Modal will close automatically when loader revalidates and
      // hasSequentialIdsMigrated becomes true.
      setStatus({ state: "completed", message: fetcher.data.message });
    } else {
      setStatus({
        state: "error",
        message: fetcher.data.message || "Failed to generate sequential IDs",
      });
    }
  }, [fetcher.data]);

  const { state, message } = status;

  return (
    <AlertDialog open={true}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-3">
            {state === "running" && <Spinner />}
            {state === "completed" && (
              <span className="text-green-600">✅</span>
            )}
            {state === "error" && <span className="text-red-600">❌</span>}
            Sequential Asset IDs
          </AlertDialogTitle>
          <AlertDialogDescription className="text-left">
            {message}
            {state === "running" && (
              <div className="mt-3 text-sm text-gray-500">
                This may take a moment depending on the number of assets...
              </div>
            )}
            {state === "error" && (
              <div className="mt-3">
                <Button
                  type="button"
                  onClick={() => window.location.reload()}
                  size="sm"
                  variant="secondary"
                >
                  Try Again
                </Button>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button
              type="button"
              variant="secondary"
              disabled={state !== "completed"}
            >
              Close
            </Button>
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
