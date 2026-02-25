import type React from "react";
import { useRef, useEffect } from "react";
import type { AuditAsset } from "@prisma/client";
import { useSetAtom } from "jotai";
import { ImagePlus, Loader, MessageSquarePlus } from "lucide-react";
import { useFetcher } from "react-router";
import { incrementAuditAssetMetaAtom } from "~/atoms/qr-scanner";
import { Button } from "~/components/shared/button";
import { useDisabled } from "~/hooks/use-disabled";
import { tw } from "~/utils/tw";

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
  const fetcher = useFetcher({ key: `quick-image-upload-${auditAssetId}` });
  const incrementMeta = useSetAtom(incrementAuditAssetMetaAtom);
  // Check if fetcher is uploading
  const isUploading = useDisabled(fetcher);
  const hasError = fetcher.state === "idle" && fetcher.data?.error;

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
      // Clear file input on success or error
      if (fileInputRef.current && !fetcher.data.error) {
        fileInputRef.current.value = "";
      }
    }
  }, [fetcher.state, fetcher.data]);

  const lastProcessedImageRef = useRef<string | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data.error) {
      return;
    }

    const imageId = fetcher.data?.image?.id;
    if (
      fetcher.data?.success &&
      imageId &&
      auditAssetId &&
      lastProcessedImageRef.current !== imageId
    ) {
      lastProcessedImageRef.current = imageId;
      // Update local count so the scan list reflects the new image immediately.
      incrementMeta({ auditAssetId, imagesDelta: 1 });
    }
  }, [fetcher.state, fetcher.data, auditAssetId, incrementMeta]);

  const totalCount = notesCount + imagesCount;

  return (
    <div className="flex items-center gap-2">
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
        variant="secondary"
        size="xs"
        className="relative"
        title="Add comment"
        to={`${auditAssetId}/details`}
      >
        <span className="flex items-center gap-1">
          <MessageSquarePlus className="inline-block size-4" />
          <span>Add comment</span>
          {totalCount > 0 && (
            <span className="absolute -right-2 -top-2 flex size-4 items-center justify-center rounded-full bg-gray-300 text-[10px] font-medium text-gray-800">
              {totalCount}
            </span>
          )}
        </span>
      </Button>

      {/* Quick camera/image picker - especially useful on mobile */}
      <Button
        type="button"
        variant="secondary"
        size="xs"
        disabled={isUploading}
        onClick={handleQuickImageUpload}
        className={tw("relative", hasError && "border border-error-500")}
        title="Add image"
      >
        <span className="flex items-center gap-1">
          {isUploading ? (
            <Loader
              className="size-4"
              style={{ animation: "spinner 2s linear infinite" }}
            />
          ) : (
            <ImagePlus className="size-4" />
          )}
          Add image
        </span>
      </Button>
    </div>
  );
}
