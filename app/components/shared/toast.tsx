import { useEffect } from "react";
import * as Toast from "@radix-ui/react-toast";

import { useAtom } from "jotai";
import { useEventSource } from "remix-utils/sse/react";
import {
  clearNotificationAtom,
  showNotificationAtom,
} from "~/atoms/notifications";
import { tw } from "~/utils/tw";
import { iconsMap } from "./icons-map";
import When from "../when/when";

export const Toaster = () => {
  const [, clearNotification] = useAtom(clearNotificationAtom);
  const [notification, showNotification] = useAtom(showNotificationAtom);

  const { open, title, message, icon } = notification;

  const variants = {
    primary: tw(`border-primary-50 bg-primary-100 text-primary`),
    gray: tw(`border-gray-50 bg-gray-100 text-gray-700`),
    success: tw(`border-success-50 bg-success-100 text-success-600`),
    error: tw(`border-error-50 bg-error-100 text-error-600`),
  };

  /** New notification coming from the server */
  const newNotification = useEventSource(`/api/sse/notification`, {
    event: "new-notification",
  });
  /** When the stream sends us a new notification update the state so it displays */
  useEffect(() => {
    if (!newNotification) return;
    showNotification(JSON.parse(newNotification));
  }, [newNotification, showNotification]);

  return (
    <Toast.Provider swipeDirection="right" duration={3000}>
      <Toast.Root
        className={tw(
          "flex gap-4 rounded border border-gray-100 bg-white p-3 shadow-xl",
          "data-[swipe=cancel]:translate-x-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[state=closed]:animate-hide data-[state=open]:animate-slideIn data-[swipe=end]:animate-swipeOut data-[swipe=cancel]:transition-[transform_200ms_ease-out]"
        )}
        open={open}
        onOpenChange={clearNotification}
      >
        <div>
          <div
            className={tw(
              variants[icon.variant],
              " flex size-10 items-center justify-center rounded-full border-[6px] ",
              icon.className
            )}
          >
            {iconsMap[icon.name]}
          </div>
        </div>
        <div className="flex-1">
          <Toast.Title className=" text-text-sm font-semibold text-gray-900 ">
            {title}
          </Toast.Title>

          <When truthy={!!message}>
            <Toast.Description className="text-gray-600">
              {message}
            </Toast.Description>
          </When>
        </div>

        <Toast.Close
          className="flex"
          onClick={clearNotification}
          data-test-id="closeToast"
        >
          {iconsMap["x"]}
        </Toast.Close>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-0 right-0 z-[2147483647] m-0 flex w-full max-w-[100vw] list-none flex-col gap-[10px] p-[var(--viewport-padding)] outline-none [--viewport-padding:_25px] md:w-[390px]" />
    </Toast.Provider>
  );
};
