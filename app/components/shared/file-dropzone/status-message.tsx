import type { Fetcher } from "@remix-run/react";
import { CheckmarkIcon, ImageFileIcon } from "~/components/icons/library";
import { tw } from "~/utils";
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
  /** Indicates if tehre was a front-end error with the dropzone */
  error: boolean;
}) {
  const { data, type } = fetcher;

  const isError = data?.error || error;
  const isPending = ["actionSubmission", "loaderSubmission"].includes(type);
  const isDone = type === "done";

  const styles = tw(
    "flex max-w-full gap-[14px] rounded-xl border bg-white p-[14px] text-text-sm text-gray-600", // default class
    isError && "border-error-300 bg-error-25 text-error-600" // Class indicating the current status
  );

  const filenameStyles = tw(
    "font-medium text-gray-700", // default style
    isError && "text-error-700"
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
