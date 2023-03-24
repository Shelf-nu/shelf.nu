import { useEffect, useState } from "react";
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
  const [visible, setVisible] = useState<boolean>(true);
  const isError = status === "error";
  const isPending = status === "pending";
  const isDone = status === "done";

  useEffect(() => {
    if (isDone) {
      /** Hides the status message after 5 after successfull upload */
      const hide = setTimeout(() => {
        setVisible(() => false);
      }, 5000);

      return () => clearTimeout(hide);
    }
  }, [isDone]);

  const styles = tw(
    "flex gap-[14px] rounded-xl border bg-white p-[14px] text-text-sm text-gray-600", // default class
    isError && "border-error-300 bg-error-25 text-error-600" // Class indicating the current status
  );

  const filenameStyles = tw(
    "font-medium text-gray-700", // default style
    isError && "text-error-700"
  );

  return message && visible ? (
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
