import type { WorkingHoursOverride } from "@prisma/client";
import type { SerializeFrom } from "@remix-run/node";
import { useFetcher } from "@remix-run/react";
import { TrashIcon } from "lucide-react";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";

interface OverridePreviewProps {
  override: SerializeFrom<WorkingHoursOverride>;
}

export function OverridePreview({ override }: OverridePreviewProps) {
  const deleteFetcher = useFetcher();
  const disabled = useDisabled(deleteFetcher);

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this override?")) {
      deleteFetcher.submit(
        {
          intent: "deleteOverride",
          overrideId: override.id,
        },
        { method: "post" }
      );
    }
  };

  // Format the date for display
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Format the time display
  const formatTimeRange = (): string => {
    if (!override.isOpen) {
      return "Closed all day";
    }

    if (override.openTime && override.closeTime) {
      return `${override.openTime} - ${override.closeTime}`;
    }

    return "Open (times not specified)";
  };

  return (
    <div className="mt-2 flex items-center justify-between rounded-lg border border-gray-200 p-4 transition-colors">
      <div className="flex-1">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-900">
            {formatDate(override.date)}
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
        <div className="mt-1 flex items-center gap-4 text-sm text-gray-600">
          <span>{formatTimeRange()}</span>
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
  );
}
