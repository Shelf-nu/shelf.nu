import type React from "react";
import { useCallback, useEffect, useReducer, useRef } from "react";
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
import type { FeedbackErrorContext } from "~/modules/feedback/schema";
import {
  FEEDBACK_ERROR_CONTEXT_FIELDS,
  FEEDBACK_FIELD_LIMITS,
  feedbackSchema,
} from "~/modules/feedback/schema";
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
  /**
   * When set, the modal acts as an error-report form: the type toggle is
   * hidden (it is always an issue) and the error details travel along as
   * hidden fields so support can correlate the report with Sentry/logs.
   */
  errorContext?: FeedbackErrorContext | null;
};

/** Local state for the feedback modal. Grouped in a reducer to keep
 * related UI transitions (type toggle, screenshot pick, success view)
 * expressed as explicit actions. */
type FeedbackState = {
  feedbackType: "issue" | "idea";
  screenshot: File | null;
  previewUrl: string | null;
  showSuccess: boolean;
  fileError: string | null;
};

type FeedbackAction =
  | { type: "set_feedback_type"; value: "issue" | "idea" }
  | { type: "set_screenshot"; file: File | null; previewUrl: string | null }
  | { type: "clear_screenshot" }
  | { type: "set_file_error"; message: string | null }
  | { type: "show_success" }
  | { type: "reset" };

const INITIAL_FEEDBACK_STATE: FeedbackState = {
  feedbackType: "issue",
  screenshot: null,
  previewUrl: null,
  showSuccess: false,
  fileError: null,
};

const TYPE_OPTIONS = [
  { value: "issue", label: "Issue", Icon: TriangleAlertIcon },
  { value: "idea", label: "Idea", Icon: LightbulbIcon },
] as const;

/** Issue/Idea selector rendered as two toggle buttons */
function TypeToggle({
  value,
  onChange,
}: {
  value: "issue" | "idea";
  onChange: (value: "issue" | "idea") => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-gray-700">Type</legend>
      <div className="flex gap-2">
        {TYPE_OPTIONS.map(({ value: option, label, Icon }) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={tw(
              "flex flex-1 items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors",
              value === option
                ? "border-primary-400 bg-primary-50 text-primary-700"
                : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
            )}
            aria-pressed={value === option}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Optional screenshot picker with preview and remove affordance */
function ScreenshotField({
  previewUrl,
  screenshot,
  fileError,
  fileInputRef,
  onFileChange,
  onRemove,
}: {
  previewUrl: string | null;
  screenshot: File | null;
  fileError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium text-gray-700">
        Screenshot <span className="font-normal text-gray-500">(optional)</span>
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
            onClick={onRemove}
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
        onChange={onFileChange}
        className="hidden"
        aria-label="Upload screenshot"
      />

      {fileError ? (
        <p className="mt-1 text-sm text-error-600">{fileError}</p>
      ) : null}
    </div>
  );
}

/** Small inline banner used for the server-error and error-report notices */
function InlineBanner({
  tone,
  children,
}: {
  tone: "info" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={tw(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
        tone === "error"
          ? "border-error-300 bg-error-50 text-error-700"
          : "border-gray-200 bg-gray-50 text-gray-600"
      )}
    >
      <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function feedbackReducer(
  state: FeedbackState,
  action: FeedbackAction
): FeedbackState {
  switch (action.type) {
    case "set_feedback_type":
      return { ...state, feedbackType: action.value };
    case "set_screenshot":
      return {
        ...state,
        screenshot: action.file,
        previewUrl: action.previewUrl,
        fileError: null,
      };
    case "clear_screenshot":
      return { ...state, screenshot: null, previewUrl: null };
    case "set_file_error":
      return { ...state, fileError: action.message };
    case "show_success":
      return { ...state, showSuccess: true };
    case "reset":
      return INITIAL_FEEDBACK_STATE;
    default:
      return state;
  }
}

export default function FeedbackModal({
  open,
  onClose,
  errorContext,
}: FeedbackModalProps) {
  const fetcher = useFetcher<DataOrErrorResponse>();
  const disabled = useDisabled(fetcher);
  const zo = useZorm("Feedback", feedbackSchema);
  const [state, dispatch] = useReducer(feedbackReducer, INITIAL_FEEDBACK_STATE);
  const { feedbackType, screenshot, previewUrl, showSuccess, fileError } =
    state;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validationErrors = getValidationErrors<typeof feedbackSchema>(
    fetcher.data?.error
  );

  const generalError =
    fetcher.data?.error && !validationErrors
      ? fetcher.data.error.message
      : null;

  /* Auto-captured page context, sent as hidden fields so support can
   * reproduce reports. The window guards are load-bearing: this body also
   * runs during SSR (e.g. server-rendered error pages) even though the
   * portal output only exists client-side. Values are clamped to the schema
   * max lengths, otherwise an oversized URL would fail validation on a
   * hidden field and silently block the submission. */
  const currentUrl =
    typeof window === "undefined"
      ? ""
      : window.location.href.slice(0, FEEDBACK_FIELD_LIMITS.currentUrl);
  const viewport =
    typeof window === "undefined"
      ? ""
      : `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`.slice(
          0,
          FEEDBACK_FIELD_LIMITS.viewport
        );

  const handleClose = useCallback(() => {
    if (autoCloseTimerRef.current) {
      clearTimeout(autoCloseTimerRef.current);
      autoCloseTimerRef.current = null;
    }
    dispatch({ type: "reset" });
    onClose();
  }, [onClose]);

  /* Tracks which fetcher response the success view was already shown for.
   * Without it, reopening a still-mounted modal after a successful send
   * replays the stale success data: the user would only ever see the
   * "Thank you" screen again and could never file a second report. */
  const handledSuccessDataRef = useRef<unknown>(null);

  useEffect(
    function handleSuccess() {
      if (
        fetcher.data &&
        !fetcher.data.error &&
        fetcher.state === "idle" &&
        handledSuccessDataRef.current !== fetcher.data
      ) {
        handledSuccessDataRef.current = fetcher.data;
        dispatch({ type: "show_success" });
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

    if (file && file.size > DEFAULT_MAX_IMAGE_UPLOAD_SIZE) {
      const maxMB = DEFAULT_MAX_IMAGE_UPLOAD_SIZE / (1024 * 1024);
      dispatch({
        type: "set_file_error",
        message: `File size exceeds the ${maxMB}MB limit`,
      });
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    dispatch({
      type: "set_screenshot",
      file,
      previewUrl: file ? URL.createObjectURL(file) : null,
    });
  }

  function removeScreenshot() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    dispatch({ type: "clear_screenshot" });
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
              {errorContext ? "Report this issue" : "Share feedback"}
            </h3>
            <p className="text-sm text-gray-600">
              {errorContext
                ? "Tell us what happened. The technical details are included automatically."
                : "What would you like to share?"}
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
                <InlineBanner tone="error">{generalError}</InlineBanner>
              ) : null}

              {/* Category toggle. Hidden for error reports: those are always
              issues, so there is nothing to choose. */}
              <div className={errorContext ? "hidden" : undefined}>
                <TypeToggle
                  value={feedbackType}
                  onChange={(value) =>
                    dispatch({ type: "set_feedback_type", value })
                  }
                />
                <input
                  type="hidden"
                  name={zo.fields.type()}
                  value={feedbackType}
                />
              </div>

              {/* Context captured automatically so support can reproduce
              reports without asking the user follow-up questions. Values are
              clamped to the schema limits so validation can't fail on a
              field the user can neither see nor fix. */}
              <input
                type="hidden"
                name={zo.fields.currentUrl()}
                value={currentUrl}
              />
              <input
                type="hidden"
                name={zo.fields.viewport()}
                value={viewport}
              />
              {errorContext
                ? FEEDBACK_ERROR_CONTEXT_FIELDS.map((field) => {
                    const value = errorContext[field];
                    return value ? (
                      <input
                        key={field}
                        type="hidden"
                        name={zo.fields[field]()}
                        value={value.slice(0, FEEDBACK_FIELD_LIMITS[field])}
                      />
                    ) : null;
                  })
                : null}

              {/* Reassure the user that the technical details travel along,
              so they only need to describe what they were doing */}
              {errorContext ? (
                <InlineBanner tone="info">
                  The error details
                  {errorContext.traceId
                    ? ` (trace id ${errorContext.traceId})`
                    : errorContext.sentryEventId
                    ? ` (error id ${errorContext.sentryEventId})`
                    : ""}{" "}
                  are attached to your report automatically.
                </InlineBanner>
              ) : null}

              {/* Message textarea */}
              <Input
                inputType="textarea"
                label="Message"
                name={zo.fields.message()}
                placeholder={
                  errorContext
                    ? "What were you trying to do when this error happened?"
                    : feedbackType === "issue"
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
              <ScreenshotField
                previewUrl={previewUrl}
                screenshot={screenshot}
                fileError={fileError}
                fileInputRef={fileInputRef}
                onFileChange={handleFileChange}
                onRemove={removeScreenshot}
              />

              {/* The error variant discloses this in its banner instead */}
              {!errorContext ? (
                <p className="text-xs text-gray-500">
                  Your current page and browser details are included
                  automatically to help us debug.
                </p>
              ) : null}
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
