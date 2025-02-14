import { useEffect } from "react";
import { Crisp } from "crisp-sdk-web";
import { useUserData } from "~/hooks/use-user-data";
import type { ButtonProps } from "../shared/button";
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
        `${user?.firstName ? user.firstName : ""} ${
          user?.lastName ? user.lastName : ""
        } (${user.username}) `
      );
    }
  }, [user]);
}

export const CrispButton = (props: ButtonProps) => (
  <Button {...props} onClick={() => Crisp.chat.open()} type="button">
    {props.children}
  </Button>
);
