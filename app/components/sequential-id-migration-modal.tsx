import { useEffect, useState } from "react";
import { useFetcher } from "@remix-run/react";
import { Button } from "~/components/shared/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/shared/modal";
import { Spinner } from "~/components/shared/spinner";
import type { action } from "~/routes/api+/generate-sequential-ids";

interface SequentialIdMigrationModalProps {
  isOpen: boolean;
}

type MigrationState = "starting" | "running" | "completed" | "error";

export function SequentialIdMigrationModal({
  isOpen,
}: SequentialIdMigrationModalProps) {
  const fetcher = useFetcher<typeof action>();
  const [state, setState] = useState<MigrationState>("starting");
  const [message, setMessage] = useState("");

  // Auto-start migration when modal opens
  useEffect(() => {
    if (isOpen && state === "starting") {
      setState("running");
      setMessage("Setting up sequential IDs for your organization...");
      fetcher.submit(
        {},
        { action: "/api/generate-sequential-ids", method: "post" }
      );
    }
  }, [isOpen, state, fetcher]);

  // Handle fetcher response
  useEffect(() => {
    if (fetcher.data) {
      if ("success" in fetcher.data && fetcher.data.success) {
        setState("completed");
        setMessage(fetcher.data.message);

        // Auto-close after 3 seconds
        setTimeout(() => {
          window.location.reload(); // Refresh to hide modal and update data
        }, 3000);
      } else {
        setState("error");
        setMessage(fetcher.data.message || "Failed to generate sequential IDs");
      }
    }
  }, [fetcher.data]);

  if (!isOpen) return null;

  return (
    <AlertDialog open={isOpen}>
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
            {state === "completed" && (
              <div className="mt-3 text-sm text-gray-500">
                Redirecting in a moment...
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
      </AlertDialogContent>
    </AlertDialog>
  );
}
