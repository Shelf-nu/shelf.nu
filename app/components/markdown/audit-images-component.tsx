import React from "react";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Spinner } from "~/components/shared/spinner";
import useApiQuery from "~/hooks/use-api-query";

/**
 * AuditImagesComponent for Markdoc
 *
 * This component renders audit completion images as small thumbnails
 * with preview capability. Used in audit completion notes.
 *
 * Usage in markdown content:
 * {% audit_images count=3 ids="id1,id2,id3" /%}
 */

interface AuditImagesComponentProps {
  count: number;
  ids: string;
  disablePortal?: boolean;
}

interface AuditImage {
  id: string;
  imageUrl: string;
  thumbnailUrl: string;
  description?: string | null;
}

export const AuditImagesComponent = React.memo(
  function AuditImagesComponent({
    count,
    ids,
    disablePortal,
  }: AuditImagesComponentProps) {
    // Memoize the API URL to prevent unnecessary refetches
    const apiUrl = React.useMemo(() => `/api/audit-images?ids=${ids}`, [ids]);

    const { data, isLoading, error } = useApiQuery<{ images: AuditImage[] }>({
      api: apiUrl,
    });

    // Parse expected image IDs
    const { expectedIds, expectedCount } = React.useMemo(() => {
      const idsArray = ids.split(",").filter(Boolean);
      return { expectedIds: idsArray, expectedCount: idsArray.length };
    }, [ids]);
    // Note: expectedIds not currently used, but keeping for potential future use
    void expectedIds;
    const images = data?.images || [];
    const missingCount = Math.max(0, expectedCount - images.length);

    if (isLoading) {
      return (
        <div className="my-2 flex items-center gap-2">
          <Spinner className="size-4" />
          <span className="text-sm text-gray-500">
            Loading {count} image{count === 1 ? "" : "s"}...
          </span>
        </div>
      );
    }

    if (error || images.length === 0) {
    // If we expected images but got none (all deleted), show placeholders
    if (expectedCount > 0) {
      return (
        <div className="my-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Render placeholders for all deleted images */}
            {Array.from({ length: expectedCount }).map((_, i) => (
              <div
                key={`deleted-${i}`}
                className="flex size-16 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50"
                title="Image deleted"
              >
                <span className="text-xs text-gray-400">Deleted</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    
    // No images expected or error
    return (
      <div className="my-2 text-sm text-gray-500">
        No images attached
      </div>
    );
  }

    return (
      <div className="my-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Render actual images */}
          {images.map((image) => (
            <ImageWithPreview
              key={image.id}
              imageUrl={image.imageUrl}
              thumbnailUrl={image.thumbnailUrl}
              alt={image.description || "Audit image"}
              withPreview
              className="size-16"
              disablePortal={disablePortal}
              images={images.map((img) => ({
                id: img.id,
                imageUrl: img.imageUrl,
                thumbnailUrl: img.thumbnailUrl,
                alt: img.description || "Audit image",
              }))}
              currentImageId={image.id}
            />
          ))}
          {/* Render placeholders for deleted images */}
          {missingCount > 0 &&
            Array.from({ length: missingCount }).map((_, i) => (
              <div
                key={`deleted-${i}`}
                className="flex size-16 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50"
                title="Image deleted"
              >
                <span className="text-xs text-gray-400">Deleted</span>
              </div>
            ))}
        </div>
      </div>
    );
  },
  (prevProps, nextProps) =>
    // Only re-render if ids or disablePortal actually changed
    prevProps.ids === nextProps.ids &&
    prevProps.disablePortal === nextProps.disablePortal
);
