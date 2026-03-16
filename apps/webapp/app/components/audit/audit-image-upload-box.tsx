import type React from "react";
import { useRef, useState, useEffect, useCallback } from "react";
import { useAtom } from "jotai";
import { Plus, X } from "lucide-react";
import { fileErrorAtom } from "~/atoms/file";
import ImageWithPreview from "~/components/image-with-preview/image-with-preview";
import { Spinner } from "~/components/shared/spinner";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { sanitizeFile } from "~/utils/sanitize-filename";
import { tw } from "~/utils/tw";
import { verifyAccept } from "~/utils/verify-file-accept";

export type SelectedImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type AuditImageUploadBoxProps = {
  /** Callback when an image is selected */
  onImageSelect: (file: File, previewUrl: string) => void;
  /** Callback after all selected files are processed */
  onBatchComplete?: () => void;
  /** Current number of uploaded images */
  currentCount: number;
  /** Maximum number of images allowed */
  maxCount: number;
  /** Disabled state */
  disabled?: boolean;
  /** Ref to expose file picker trigger function */
  onExposeFilePicker?: (
    trigger: (currentSelectedCount?: number) => void
  ) => void;
  /** Total count from parent (includes dialog selections) */
  totalCountFromParent?: number;
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
  onBatchComplete,
  currentCount,
  maxCount,
  disabled = false,
  onExposeFilePicker,
  totalCountFromParent,
}: AuditImageUploadBoxProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [, setFileError] = useAtom(fileErrorAtom);

  const canAddMore = currentCount < maxCount;

  // Create stable trigger function using refs to avoid stale closures
  const triggerRef = useRef<(currentSelectedCount?: number) => void>(() => {});

  // Update the trigger function whenever dependencies change
  triggerRef.current = (currentSelectedCount?: number) => {
    const input = inputRef.current;
    // Priority: currentSelectedCount > totalCountFromParent > currentCount
    const effectiveCount =
      currentSelectedCount !== undefined
        ? currentSelectedCount
        : totalCountFromParent !== undefined
        ? totalCountFromParent
        : currentCount;
    const canAdd = effectiveCount < maxCount;
    if (input && canAdd && !disabled) {
      input.click();
    }
  };

  // Expose file picker trigger to parent
  useEffect(() => {
    if (onExposeFilePicker) {
      // Pass a stable function that calls the current ref
      onExposeFilePicker((count) => triggerRef.current(count));
    }
  }, [onExposeFilePicker]);

  const handleClick = () => {
    if (!disabled && canAddMore) {
      inputRef.current?.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Clear any previous errors
    setFileError(undefined);

    // Check if adding these files would exceed the limit
    const filesArray = Array.from(files);
    const remainingSlots = maxCount - currentCount;

    if (filesArray.length > remainingSlots) {
      setFileError(
        `You can only upload ${remainingSlots} more image${
          remainingSlots === 1 ? "" : "s"
        }`
      );
      e.target.value = "";
      return;
    }

    // Validate and process each file
    filesArray.forEach((file) => {
      // Validate file type
      const allowedType = verifyAccept(
        file.type,
        "image/png,image/jpeg,image/jpg"
      );
      if (!allowedType) {
        setFileError("Allowed file types are: PNG, JPG or JPEG");
        return;
      }

      // Validate file size (4MB limit)
      const allowedSize = file.size < DEFAULT_MAX_IMAGE_UPLOAD_SIZE;
      if (!allowedSize) {
        setFileError("Max file size is 4MB");
        return;
      }

      // Sanitize filename and create preview
      const sanitizedFile = sanitizeFile(file);
      const previewUrl = URL.createObjectURL(sanitizedFile);
      onImageSelect(sanitizedFile, previewUrl);
    });

    // Call batch complete after all files are processed
    if (onBatchComplete && filesArray.length > 0) {
      onBatchComplete();
    }

    // Reset input so the same file can be selected again if needed
    e.target.value = "";
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
        multiple
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
  /** Callback when new images are selected (opens dialog) */
  onImagesSelected?: (images: SelectedImage[]) => void;
  /** Indicates if upload is currently in progress */
  isUploading?: boolean;
  /** External trigger to clear selected images */
  clearTrigger?: number;
  /** Ref to expose file picker trigger function */
  onExposeFilePicker?: (
    trigger: (currentSelectedCount?: number) => void
  ) => void;
  /** Current count of images selected in dialog (overrides local count for trigger) */
  currentSelectedInDialog?: number;
  /** Ref to expose image removal function */
  onExposeImageRemoval?: (removalFn: (id: string) => void) => void;
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
  onImagesSelected,
  isUploading = false,
  clearTrigger = 0,
  onExposeFilePicker,
  currentSelectedInDialog,
  onExposeImageRemoval,
}: AuditImageUploadSectionProps) {
  const [images, setImages] = useState<
    Array<{ file: File; previewUrl: string; id: string }>
  >([]);
  const [pendingBatchComplete, setPendingBatchComplete] = useState(false);
  const [fileError] = useAtom(fileErrorAtom);
  const fileInputsRef = useRef<Map<string, HTMLInputElement>>(new Map());
  const previousIsUploadingRef = useRef(isUploading);
  const previousClearTriggerRef = useRef(clearTrigger);

  // Effect to clear images when external trigger changes
  useEffect(() => {
    // Only clear if clearTrigger actually changed (not on initial mount)
    if (clearTrigger > 0 && clearTrigger !== previousClearTriggerRef.current) {
      images.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
      });
      setImages([]);
      fileInputsRef.current.clear();
      setPendingBatchComplete(false);
    }
    previousClearTriggerRef.current = clearTrigger;
  }, [clearTrigger, images]);

  // Clear preview images when upload completes successfully
  useEffect(() => {
    // Detect when upload transitions from in-progress to complete
    const uploadJustCompleted = previousIsUploadingRef.current && !isUploading;

    if (uploadJustCompleted && images.length > 0) {
      // Clean up blob URLs
      images.forEach((image) => {
        URL.revokeObjectURL(image.previewUrl);
      });
      setImages([]);
      fileInputsRef.current.clear();
    }

    previousIsUploadingRef.current = isUploading;
  }, [isUploading, images]);

  // Total count includes both existing and new images
  const totalCount = existingImages.length + images.length;
  const effectiveCountForBox =
    currentSelectedInDialog !== undefined
      ? existingImages.length + currentSelectedInDialog
      : totalCount;

  const handleImageSelect = (file: File, previewUrl: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setImages((prev) => [...prev, { file, previewUrl, id }]);
  };

  const handleBatchComplete = () => {
    // Mark that we need to call onImagesSelected after state updates
    setPendingBatchComplete(true);
  };

  // Effect to call onImagesSelected after images state updates
  useEffect(() => {
    if (pendingBatchComplete && images.length > 0 && onImagesSelected) {
      onImagesSelected(images);
      setPendingBatchComplete(false);
    }
  }, [pendingBatchComplete, images, onImagesSelected]);

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

  // Expose image removal function to parent
  useEffect(() => {
    if (onExposeImageRemoval) {
      onExposeImageRemoval(handleImageRemove);
    }
  }, [onExposeImageRemoval]);

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
      {isUploading && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Spinner className="size-4" />
          Uploading images...
        </div>
      )}

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
            onBatchComplete={handleBatchComplete}
            currentCount={effectiveCountForBox}
            maxCount={maxCount}
            disabled={disabled}
            onExposeFilePicker={onExposeFilePicker}
            totalCountFromParent={effectiveCountForBox}
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
