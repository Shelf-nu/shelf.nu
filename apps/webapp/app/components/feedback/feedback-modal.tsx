import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Crisp } from "crisp-sdk-web";
import {
  AlertCircleIcon,
  ImageIcon,
  LightbulbIcon,
  MessageCircleIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { useFetcher } from "react-router";
import { useZorm } from "react-zorm";
import { useDisabled } from "~/hooks/use-disabled";
import { feedbackSchema } from "~/modules/feedback/schema";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { getValidationErrors } from "~/utils/http";
import type { DataOrErrorResponse } from "~/utils/http.server";
import { tw } from "~/utils/tw";
import Input from "../forms/input";
import { Dialog, DialogPortal } from "../layout/dialog";
import { Button } from "../shared/button";

type FeedbackModalProps = {
  open: boolean;
  onClose: () => void;
};

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const fetcher = useFetcher<DataOrErrorResponse>();
  const disabled = useDisabled(fetcher);
  const zo = useZorm("Feedback", feedbackSchema);
  const [feedbackType, setFeedbackType] = useState<"issue" | "idea">("issue");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validationErrors = getValidationErrors<typeof feedbackSchema>(
    fetcher.data?.error
  );

  const generalError =
    fetcher.data?.error && !validationErrors
      ? fetcher.data.error.message
      : null;

  const handleClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    setFeedbackType("issue");
    setScreenshot(null);
    setPreviewUrl(null);
    setShowSuccess(false);
    setFileError(null);
    onClose();
  }, [onClose]);

  useEffect(
    function handleSuccess() {
      if (fetcher.data && !fetcher.data.error && fetcher.state === "idle") {
        setShowSuccess(true);
        autoCloseTimerRef.current = setTimeout(() => {
          autoCloseTimerRef.current = null;
          handleClose();
        }, 2000);
        return () => {
          if (autoCloseTimerRef.current) {
            clearTimeout(autoCloseTimerRef.current);
            autoCloseTimerRef.current = null;
          }
        };
      }
    },
    [fetcher.data, fetcher.state, handleClose]
  );

  useEffect(
    function cleanupPreviewUrl() {
      return () => {
        if (previewUrl) {
          URL.revokeObjectURL(previewUrl);
        }
      };
    },
    [previewUrl]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setFileError(null);

    if (file && file.size > DEFAULT_MAX_IMAGE_UPLOAD_SIZE) {
      const maxMB = DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024);
      setFileError(`File size exceeds the ${maxMB}MB limit`);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    setScreenshot(file);

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    if (file) {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
  }

  function removeScreenshot() {
    setScreenshot(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <DialogPortal>
      <Dialog
        open={open}
        onClose={handleClose}
        className="w-full sm:w-[440px]"
        headerClassName="border-b"
        title={
          <div className="-mb-3 w-full pb-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Share feedback
            </h3>
            <p className="text-sm text-gray-600">
              What would you like to share?
            </p>
          </div>
        }
      >
        {showSuccess ? (
          <div className="flex flex-col items-center justify-center px-6 py-12">
            <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-green-100">
              <svg
                className="size-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-lg font-semibold text-gray-900">Thank you!</p>
            <p className="text-sm text-gray-600">
              Your feedback has been submitted.
            </p>
          </div>
        ) : (
          <fetcher.Form
            ref={zo.ref}
            method="POST"
            action="/api/feedback"
            encType="multipart/form-data"
            className="flex flex-col"
          >
            <div className="space-y-4 px-6 py-4">
              {/* General server error */}
              {generalError ? (
                <div className="flex items-start gap-2 rounded-lg border border-error-300 bg-error-50 px-3 py-2 text-sm text-error-700">
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span>{generalError}</span>
                </div>
              ) : null}

              {/* Category toggle */}
              <div>
                <fieldset>
                  <legend className="mb-2 text-sm font-medium text-gray-700">
                    Type
                  </legend>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFeedbackType("issue")}
                      className={tw(
                        "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                        feedbackType === "issue"
                          ? "border-primary-400 bg-primary-50 text-primary-700"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      )}
                      aria-pressed={feedbackType === "issue"}
                    >
                      <TriangleAlertIcon className="size-4" />
                      Issue
                    </button>
                    <button
                      type="button"
                      onClick={() => setFeedbackType("idea")}
                      className={tw(
                        "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
                        feedbackType === "idea"
                          ? "border-primary-400 bg-primary-50 text-primary-700"
                          : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                      )}
                      aria-pressed={feedbackType === "idea"}
                    >
                      <LightbulbIcon className="size-4" />
                      Idea
                    </button>
                  </div>
                </fieldset>
                <input
                  type="hidden"
                  name={zo.fields.type()}
                  value={feedbackType}
                />
              </div>

              {/* Message textarea */}
              <Input
                inputType="textarea"
                label="Message"
                name={zo.fields.message()}
                placeholder={
                  feedbackType === "issue"
                    ? "Tell us about the issue you're experiencing..."
                    : "Share your idea for improving Shelf..."
                }
                rows={5}
                maxLength={5000}
                required
                error={
                  validationErrors?.message?.message ||
                  zo.errors.message()?.message
                }
              />

              {/* Screenshot upload */}
              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">
                  Screenshot{" "}
                  <span className="font-normal text-gray-500">(optional)</span>
                </p>

                {previewUrl && screenshot ? (
                  <div className="relative inline-block">
                    <img
                      src={previewUrl}
                      alt="Screenshot preview"
                      className="h-24 rounded-lg border border-gray-200 object-cover"
                    />
                    <button
                      type="button"
                      onClick={removeScreenshot}
                      className="absolute -right-2 -top-2 rounded-full border border-gray-200 bg-white p-0.5 shadow-sm hover:bg-gray-50"
                      aria-label="Remove screenshot"
                    >
                      <XIcon className="size-3.5 text-gray-500" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-3 text-sm text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50"
                  >
                    <ImageIcon className="size-4" />
                    Attach a screenshot
                  </button>
                )}

                <input
                  ref={fileInputRef}
                  type="file"
                  name="screenshot"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handleFileChange}
                  className="hidden"
                  aria-label="Upload screenshot"
                />

                {fileError ? (
                  <p className="mt-1 text-sm text-error-600">{fileError}</p>
                ) : null}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t px-6 py-4">
              <button
                type="button"
                onClick={() => {
                  Crisp.chat.open();
                  handleClose();
                }}
                className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-gray-700"
              >
                <MessageCircleIcon className="size-4" />
                Chat with us
              </button>

              <Button type="submit" disabled={disabled}>
                {disabled ? "Sending..." : "Send feedback"}
              </Button>
            </div>
          </fetcher.Form>
        )}
      </Dialog>
    </DialogPortal>
  );
}
