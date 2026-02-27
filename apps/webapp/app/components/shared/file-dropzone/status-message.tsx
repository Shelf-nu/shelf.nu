import { useMemo } from "react";
import type { Fetcher } from "react-router";
import { CheckmarkIcon, ImageFileIcon } from "~/components/icons/library";
import { isFormProcessing } from "~/utils/form";
import { tw } from "~/utils/tw";
import { Spinner } from "../spinner";

export interface StatusMessageProps {
  filename: string | null;
  message: string | null;
  status: "done" | "pending" | "error" | null;
}
export function StatusMessage({
  fetcher,
  filename,
  message,
  error,
}: {
  fetcher: Fetcher;
  filename: string;
  message: string | null;
  /** Indicates if there was a front-end error with the dropzone */
  error: boolean;
}) {
  const { data, state } = fetcher;

  const isError = data?.error || error;
  const isPending = isFormProcessing(state);

  const isDone = state === "idle" && data != null;

  const styles = useMemo(
    () =>
      tw(
        "flex max-w-full gap-[14px] rounded-xl border bg-surface p-[14px] text-text-sm text-color-600", // default class
        isError && "border-error-300 bg-error-25 text-error-600" // Class indicating the current status
      ),
    [isError]
  );

  const filenameStyles = useMemo(
    () =>
      tw(
        "font-medium text-color-700", // default style
        isError && "text-error-700"
      ),
    [isError]
  );

  return message ? (
    <div className={styles}>
      <ImageFileIcon error={isError} />
      <div className="flex-1">
        <div className={filenameStyles}>{filename}</div>
        <div>{message}</div>
      </div>
      {isPending && <Spinner />}
      {isDone && !isError && <CheckmarkIcon />}
    </div>
  ) : null;
}
