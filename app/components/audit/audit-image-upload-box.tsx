import type React from "react";
import { useRef, useState, useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { Plus, X } from "lucide-react";
import { auditImageValidateFileAtom, fileErrorAtom } from "~/atoms/file";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { tw } from "~/utils/tw";

type AuditImageUploadBoxProps = {
  /** Callback when an image is selected */
  onImageSelect: (file: File, previewUrl: string) => void;
  /** Current number of uploaded images */
  currentCount: number;
  /** Maximum number of images allowed */
  maxCount: number;
  /** Disabled state */
  disabled?: boolean;
};

type UploadedImageBoxProps = {
  previewUrl: string;
  onRemove: () => void;
  disabled?: boolean;
};

/**
 * Component to display an uploaded image with remove button
 */
function UploadedImageBox({
  previewUrl,
  onRemove,
  disabled,
}: UploadedImageBoxProps) {
  return (
    <div className="group relative size-24 shrink-0 overflow-hidden rounded-lg border-2 border-gray-200">
      <img src={previewUrl} alt="Audit" className="size-full object-cover" />
      {!disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-1 top-1 rounded-full bg-gray-900/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-900"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

/**
 * Gray box with plus icon that allows selecting images
 */
export function AuditImageUploadBox({
  onImageSelect,
  currentCount,
  maxCount,
  disabled = false,
}: AuditImageUploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileError] = useAtom(fileErrorAtom);
  const [, validateFile] = useAtom(auditImageValidateFileAtom);

  const canAddMore = currentCount < maxCount;

  const handleClick = () => {
    if (!disabled && canAddMore) {
      inputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    validateFile(e);

    const file = e.target.files?.[0];
    if (file && !fileError) {
      const previewUrl = URL.createObjectURL(file);
      onImageSelect(file, previewUrl);
      // Reset input so the same file can be selected again if needed
      e.target.value = "";
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || !canAddMore}
      className={tw(
        "flex size-24 shrink-0 items-center justify-center rounded-lg border-2 border-dashed transition-colors",
        canAddMore && !disabled
          ? "border-gray-300 bg-gray-50 text-gray-400 hover:border-gray-400 hover:bg-gray-100 hover:text-gray-500"
          : "cursor-not-allowed border-gray-200 bg-gray-50 text-gray-300"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg"
        onChange={handleFileChange}
        className="hidden"
      />
      <Plus className="size-8" />
    </button>
  );
}

type AuditImageUploadSectionProps = {
  /** Maximum number of images allowed */
  maxCount?: number;
  /** Disabled state */
  disabled?: boolean;
  /** Name prefix for file inputs */
  inputNamePrefix?: string;
  /** Existing images from server */
  existingImages?: Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl?: string | null;
  }>;
  /** Callback when an existing image is removed */
  onExistingImageRemove?: (imageId: string) => void;
};

/**
 * Section component that manages multiple image uploads with preview
 */
export function AuditImageUploadSection({
  maxCount = 5,
  disabled = false,
  inputNamePrefix = "auditImage",
  existingImages = [],
  onExistingImageRemove,
}: AuditImageUploadSectionProps) {
  const [images, setImages] = useState<
    Array<{ file: File; previewUrl: string; id: string }>
  >([]);
  const [fileError] = useAtom(fileErrorAtom);
  const fileInputsRef = useRef<Map<string, HTMLInputElement>>(new Map());

  // Total count includes both existing and new images
  const totalCount = existingImages.length + images.length;

  const handleImageSelect = (file: File, previewUrl: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setImages((prev) => [...prev, { file, previewUrl, id }]);
  };

  const handleImageRemove = (id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) {
        URL.revokeObjectURL(image.previewUrl);
      }
      fileInputsRef.current.delete(id);
      return prev.filter((img) => img.id !== id);
    });
  };

  const setFileInputRef = useCallback(
    (id: string, file: File) => (el: HTMLInputElement | null) => {
      if (el) {
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        el.files = dataTransfer.files;
        fileInputsRef.current.set(id, el);
      }
    },
    []
  );

  // Cleanup preview URLs on unmount
  useEffect(
    () => () => {
      images.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
      });
    },
    [images]
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label
          htmlFor="audit-images"
          className="text-sm font-medium text-gray-700"
        >
          Add Photos (Optional)
        </label>
        <span className="text-xs text-gray-500">
          {totalCount}/{maxCount} images
        </span>
      </div>
      <p className="text-sm text-gray-500">
        Add up to {maxCount} photos to document this audit completion.
      </p>

      <div id="audit-images" className="flex flex-wrap gap-2">
        {/* Display existing server images */}
        {existingImages.map((image) => (
          <div key={image.id} className="group relative size-24 shrink-0">
            <ImageWithPreview
              imageUrl={image.imageUrl}
              thumbnailUrl={image.thumbnailUrl || image.imageUrl}
              alt="Audit image"
              withPreview
              disablePortal
              className="size-24 rounded-lg border-2 border-gray-200"
              images={existingImages.map((img) => ({
                id: img.id,
                imageUrl: img.imageUrl,
                thumbnailUrl: img.thumbnailUrl || img.imageUrl,
                alt: "Audit image",
              }))}
              currentImageId={image.id}
            />
            {!disabled && onExistingImageRemove && (
              <button
                type="button"
                onClick={() => onExistingImageRemove(image.id)}
                className="absolute right-1 top-1 z-10 rounded-full bg-gray-900/70 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-900"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        ))}
        {/* Display new uploaded images */}
        {images.map((image) => (
          <UploadedImageBox
            key={image.id}
            previewUrl={image.previewUrl}
            onRemove={() => handleImageRemove(image.id)}
            disabled={disabled}
          />
        ))}
        {/* Upload box - only show if under limit */}
        {totalCount < maxCount && (
          <AuditImageUploadBox
            onImageSelect={handleImageSelect}
            currentCount={totalCount}
            maxCount={maxCount}
            disabled={disabled}
          />
        )}
      </div>

      {fileError && <p className="text-sm text-error-500">{fileError}</p>}

      {/* Hidden inputs to submit files with the form */}
      {images.map((image) => (
        <input
          ref={setFileInputRef(image.id, image.file)}
          key={image.id}
          type="file"
          name={inputNamePrefix}
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
