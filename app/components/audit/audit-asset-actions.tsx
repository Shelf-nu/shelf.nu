import type React from "react";
import { useRef, useEffect } from "react";
import type { AuditAsset } from "@prisma/client";
import { Camera, MessageSquare, Loader } from "lucide-react";
import { useFetcher, Link } from "react-router";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";

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
  assetName: _assetName,
  notesCount = 0,
  imagesCount = 0,
  isPending: _isPending = false,
}: AuditAssetActionsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetcher = useFetcher();
  // Check if fetcher is uploading
  const isUploading = useDisabled(fetcher);

  const handleQuickImageUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !auditAssetId) return;

    const formData = new FormData();
    formData.append("image", file);
    formData.append("auditAssetId", auditAssetId);

    void fetcher.submit(formData, {
      method: "POST",
      action: `/api/audits/${auditSessionId}/upload-image`,
      encType: "multipart/form-data",
    });
  };

  // Handle upload completion or errors
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      // Clear file input on success
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [fetcher.state, fetcher.data]);

  const totalCount = notesCount + imagesCount;

  return (
    <div className="flex items-center gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Main action button - opens dialog */}
      <Button
        asChild
        type="button"
        variant="ghost"
        size="xs"
        className="relative size-8 p-0"
        title="View notes and images"
      >
        <Link to={`${auditAssetId}/details`}>
          <MessageSquare className="size-4" />
          {totalCount > 0 && (
            <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-blue-600 text-[10px] font-medium text-white">
              {totalCount}
            </span>
          )}
        </Link>
      </Button>

      {/* Quick camera/image picker - especially useful on mobile */}
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={isUploading}
        onClick={handleQuickImageUpload}
        className="relative size-8 p-0"
        title="Quick image upload"
      >
        {isUploading ? (
          <Loader
            className="size-4"
            style={{ animation: "spinner 2s linear infinite" }}
          />
        ) : (
          <Camera className="size-4" />
        )}
      </Button>
    </div>
  );
}
