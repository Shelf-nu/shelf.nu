import { useCallback, useEffect } from "react";
import { useActionData, useSearchParams } from "@remix-run/react";
import { useAtom } from "jotai";
import type {
  NotificationType,
  NotificationVariant,
} from "~/atoms/notifications";
import {
  clearNotificationAtom,
  showNotificationAtom,
} from "~/atoms/notifications";
import type { Icon } from "~/components/shared/icons-map";

/**
 * This hook is used to handle the Toast behaviour
 * @param {string} id The route id
 * @returns {JSON|undefined} The router data or undefined if not found
 */
export const useToast = (): [NotificationType, () => void] => {
  /** Data atoms */
  const [notification] = useAtom(clearNotificationAtom);
  const [, showNotification] = useAtom(showNotificationAtom);

  /** Search params for handing notification */
  const [params, setSearchParams] = useSearchParams();

  /** Handles clearing notification from url params */
  const clearNotificationParams = useCallback(() => {
    setSearchParams(() => {
      const newParams = params;
      newParams.delete("notificationTitle");
      newParams.delete("notificationMessage");
      newParams.delete("notificationIcon");
      newParams.delete("notificationVariant");
      return newParams;
    });
  }, [params, setSearchParams]);

  /** Handles displaying notifications from url params */
  useEffect(() => {
    if (params?.has("notificationTitle")) {
      showNotification({
        title: params.get("notificationTitle") as string,
        message: params.get("notificationMessage") as string,
        icon: {
          name: params.get("notificationIcon") as Icon,
          variant: params.get("notificationVariant") as NotificationVariant,
        },
      });

      return () => {
        clearNotificationParams();
      };
    }
  }, [params, showNotification, clearNotificationParams]);

  /** Action data for handling notification from actions */
  const actionData = useActionData();
  useEffect(() => {
    if (actionData?.notification) {
      showNotification(actionData.notification);
    }
  }, [actionData, showNotification]);

  return [notification, clearNotificationParams];
};
