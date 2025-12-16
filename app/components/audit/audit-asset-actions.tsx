import { useState } from "react";
import type { AuditAsset } from "@prisma/client";
import { ImageIcon, MessageSquare } from "lucide-react";
import { AuditAssetDetailsDialog } from "~/components/audit/audit-asset-details-dialog";
import { Button } from "~/components/shared/button";

type AuditAssetActionsProps = {
  auditAssetId: AuditAsset["id"];
  auditSessionId: string;
  assetName: string;
  notesCount?: number;
  imagesCount?: number;
  isPending?: boolean;
};

/**
 * Action buttons for audit asset rows - allows adding comments and images
 * Shows badge indicators when notes/images exist
 */
export function AuditAssetActions({
  auditAssetId,
  auditSessionId,
  assetName,
  notesCount = 0,
  imagesCount = 0,
  isPending: _isPending = false,
}: AuditAssetActionsProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"notes" | "images">("notes");

  const handleOpenDialog = (tab: "notes" | "images") => {
    // Don't open if we don't have an auditAssetId yet
    if (!auditAssetId) return;
    setActiveTab(tab);
    setIsDialogOpen(true);
  };

  return (
    <div className="flex items-center gap-1">
      {/* Comment button */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => handleOpenDialog("notes")}
        className="relative size-8 p-0"
        title="Add comment"
        disabled={!auditAssetId}
      >
        <MessageSquare className="size-4" />
        {notesCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-medium text-white">
            {notesCount}
          </span>
        )}
      </Button>

      {/* Quick image button - especially useful on mobile */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        onClick={() => handleOpenDialog("images")}
        className="relative size-8 p-0"
        title="Add images"
        disabled={!auditAssetId}
      >
        <ImageIcon className="size-4" />
        {imagesCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-medium text-white">
            {imagesCount}
          </span>
        )}
      </Button>

      {/* Dialog for managing notes and images */}
      {isDialogOpen && (
        <AuditAssetDetailsDialog
          open={isDialogOpen}
          onClose={() => setIsDialogOpen(false)}
          auditAssetId={auditAssetId}
          auditSessionId={auditSessionId}
          assetName={assetName}
          defaultTab={activeTab}
        />
      )}
    </div>
  );
}
