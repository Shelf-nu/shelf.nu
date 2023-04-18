import { useEffect, useRef, useState } from "react";
import * as Toast from "@radix-ui/react-toast";
import { useAtom } from "jotai";
import { clearNotificationAtom } from "~/atoms/notifications";
import { tw } from "~/utils";

// eslint-disable-next-line react/display-name
export const Toaster = () => {
  const [notification, clearNotification] = useAtom(clearNotificationAtom);
  const { open, title, message, icon } = notification;
  const timerRef = useRef(0);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  return (
    <Toast.Provider swipeDirection="right">
      <Toast.Root
        className={tw(
          " rounded-lg border border-gray-100 bg-white p-3 shadow-xl",
          "data-[swipe=cancel]:translate-x-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=cancel]:transition-[transform_200ms_ease-out] ",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out"
        )}
        open={open}
        onOpenChange={clearNotification}
      >
        <Toast.Title className=" text-text-sm font-semibold text-gray-900 ">
          {title}
        </Toast.Title>
        <Toast.Description>{message}</Toast.Description>
        <Toast.Action
          className=""
          onClick={clearNotification}
          altText="Goto schedule to undo"
        >
          x
        </Toast.Action>
      </Toast.Root>
      <Toast.Viewport className="fixed bottom-0 right-0 z-[2147483647] m-0 flex w-[390px] max-w-[100vw] list-none flex-col gap-[10px] p-[var(--viewport-padding)] outline-none [--viewport-padding:_25px]" />
    </Toast.Provider>
  );
};
