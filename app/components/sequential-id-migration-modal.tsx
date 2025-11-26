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
  organizationId: string;
}

type MigrationState = "starting" | "running" | "completed" | "error";

export function SequentialIdMigrationModal({
  organizationId,
}: SequentialIdMigrationModalProps) {
  const fetcher = useFetcher<typeof action>();
  const [state, setState] = useState<MigrationState>("starting");
  const [message, setMessage] = useState(
    "Setting up sequential IDs for your organization..."
  );

  // Reset state when organization changes
  useEffect(() => {
    setState("starting");
    setMessage("Setting up sequential IDs for your organization...");
  }, [organizationId]);

  // Auto-start migration when modal opens
  useEffect(() => {
    if (state === "starting") {
      setState("running");
      setMessage("Setting up sequential IDs for your organization...");
      void fetcher.submit(
        {},
        { action: "/api/generate-sequential-ids", method: "post" }
      );
    }
  }, [state, fetcher]);

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data) {
      if ("success" in fetcher.data && fetcher.data.success) {
        setState("completed");
        setMessage(fetcher.data.message);
        // Modal will close automatically when loader revalidates and hasSequentialIdsMigrated becomes true
      } else {
        setState("error");
        setMessage(fetcher.data.message || "Failed to generate sequential IDs");
      }
    }
  }, [fetcher.data]);

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
            <Button variant="secondary" disabled={state !== "completed"}>
              Close
            </Button>
          </AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
