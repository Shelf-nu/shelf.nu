import { useFetcher } from "react-router";
import type { NotificationType } from "~/atoms/notifications";

export function useClientNotification() {
  const fetcher = useFetcher();
  const submitter = ({
    title,
    message = null,
    icon,
  }: Omit<NotificationType, "open" | "senderId">) => {
    void fetcher.submit(
      {
        title,
        message,
        icon,
      },
      {
        action: "/api/client-notification",
        method: "POST",
        encType: "application/json",
      }
    );
  };

  return [submitter];
}
