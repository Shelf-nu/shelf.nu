import { useFetcher } from "@remix-run/react";
import type { NotificationType } from "~/atoms/notifications";

export function useClientNotification() {
  const fetcher = useFetcher();
  const submitter = ({
    title,
    message,
    icon,
  }: Omit<NotificationType, "open" | "senderId">) => {
    fetcher.submit(
      {
        title,
        message,
        icon,
      },
      {
        action: "/api/client-notification",
        method: "POST",
      }
    );
  };

  return [submitter];
}
