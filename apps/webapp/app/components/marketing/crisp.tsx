import { useEffect } from "react";
import { Crisp } from "crisp-sdk-web";
import { useUserData } from "~/hooks/use-user-data";
import { resolveUserDisplayName } from "~/utils/user";
import type { HTMLButtonProps } from "../shared/button";
import { Button } from "../shared/button";

export function useCrisp() {
  const user = useUserData();

  useEffect(() => {
    if (window && window.env.CRISP_WEBSITE_ID) {
      Crisp.configure(window.env.CRISP_WEBSITE_ID, { autoload: false });
      if (!user) return;
      /** Set some user data in crisp */
      Crisp.user.setEmail(user.email);
      Crisp.user.setNickname(
        `${resolveUserDisplayName(user)} (${user.username}) `
      );
    }
  }, [user]);
}

export const CrispButton = (props: Omit<HTMLButtonProps, "type">) => (
  <Button {...props} onClick={() => Crisp.chat.open()} type="button">
    {props.children}
  </Button>
);
