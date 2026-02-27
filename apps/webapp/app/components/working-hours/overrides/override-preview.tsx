import type { WorkingHoursOverride } from "@prisma/client";
import { TrashIcon } from "lucide-react";
import { useFetcher } from "react-router";
import { Button } from "~/components/shared/button";
import { DateS } from "~/components/shared/date";
import { TimeRangeDisplay } from "~/components/shared/time-display";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";

interface OverridePreviewProps {
  override: WorkingHoursOverride;
}

export function OverridePreview({ override }: OverridePreviewProps) {
  const deleteFetcher = useFetcher();
  const disabled = useDisabled(deleteFetcher);

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this override?")) {
      void deleteFetcher.submit(
        {
          intent: "deleteOverride",
          overrideId: override.id,
        },
        { method: "post" }
      );
    }
  };

  const optimisticDeleted =
    deleteFetcher.formData &&
    deleteFetcher?.formData.get("overrideId") === override.id;

  return !optimisticDeleted ? (
    <div className="mt-2 flex items-center justify-between rounded-lg border border-color-200 p-4 transition-colors hover:border-color-300">
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-color-900">
            <DateS
              date={override.date}
              localeOnly
              options={{
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              }}
            />
          </span>
          <span
            className={tw(
              "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
              override.isOpen
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            )}
          >
            {override.isOpen ? "Open" : "Closed"}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-4 text-sm text-color-600">
          {override.isOpen ? (
            <TimeRangeDisplay
              openTime={override.openTime || undefined}
              closeTime={override.closeTime || undefined}
            />
          ) : (
            <span>Closed all day</span>
          )}
          {override.reason && (
            <>
              <span>•</span>
              <span className="italic">{override.reason}</span>
            </>
          )}
        </div>
      </div>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={handleDelete}
        title="Delete override"
      >
        <TrashIcon className="size-4" />
      </Button>
    </div>
  ) : null;
}
