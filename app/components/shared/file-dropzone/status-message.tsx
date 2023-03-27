import { CheckmarkIcon, ImageFileIcon } from "~/components/icons/library";
import { tw } from "~/utils";
import { Spinner } from "../spinner";

export interface StatusMessageProps {
  filename: string | null;
  message: string | null;
  status: "done" | "pending" | "error" | null;
}
export function StatusMessage({
  message,
  status,
  filename,
}: StatusMessageProps) {
  const isError = status === "error";
  const isPending = status === "pending";
  const isDone = status === "done";

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
      {isDone && <CheckmarkIcon />}
    </div>
  ) : null;
}
