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
}

interface AuditImage {
  id: string;
  imageUrl: string;
  thumbnailUrl: string;
  description?: string | null;
}

export function AuditImagesComponent({
  count,
  ids,
}: AuditImagesComponentProps) {
  // Fetch images from API
  const searchParams = new URLSearchParams({ ids });
  const { data, isLoading, error } = useApiQuery<{ images: AuditImage[] }>({
    api: "/api/audit-images",
    searchParams,
  });

  const images = data?.images || [];

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
    return (
      <div className="my-2 text-sm text-gray-500">
        {count} image{count === 1 ? "" : "s"} attached
      </div>
    );
  }

  return (
    <div className="my-3">
      <div className="flex flex-wrap items-center gap-2">
        {images.map((image) => (
          <ImageWithPreview
            key={image.id}
            imageUrl={image.imageUrl}
            thumbnailUrl={image.thumbnailUrl}
            alt={image.description || "Audit image"}
            withPreview
            className="size-16"
            images={images.map((img) => ({
              id: img.id,
              imageUrl: img.imageUrl,
              thumbnailUrl: img.thumbnailUrl,
              alt: img.description || "Audit image",
            }))}
            currentImageId={image.id}
          />
        ))}
      </div>
    </div>
  );
}
