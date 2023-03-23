import { useEffect, useState } from "react";
import { useSubmit } from "@remix-run/react";

/**
 * This base hook is used to logout the user after a certain delay
 * @param trigger - dependency that triggers teh hook's useEffect
 * @param logoutFormRef - ref to the form that will be used to logout the user
 * @param delay - delay before logout in ms. Default is 3000
 * @returns {boolean} - weather the side effect has finished
 */
export function useDelayedLogout({
  trigger,
  logoutFormRef,
  delay = 3000,
}: Props) {
  const submit = useSubmit();

  useEffect(() => {
    if (trigger) {
      const timer = setTimeout(async () => {
        submit(logoutFormRef.current, { replace: true });
      }, delay);

      return () => {
        if (timer) {
          clearTimeout(timer);
        }
      };
    }
  }, [trigger, submit, logoutFormRef, delay]);
}

interface Props {
  trigger: boolean;
  logoutFormRef: React.MutableRefObject<null>;
  /** Delay in ms. Default is 3000 */
  delay?: number;
}
