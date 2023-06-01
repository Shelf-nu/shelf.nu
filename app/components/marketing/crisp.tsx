import { useEffect } from "react";
import { Crisp } from "crisp-sdk-web";
import type { ButtonProps } from "../shared";
import { Button } from "../shared";

export function useCrisp() {
  useEffect(() => {
    if (window && window.env.CRISP_WEBSITE_ID) {
      Crisp.configure(window.env.CRISP_WEBSITE_ID, { autoload: false });
    }
  }, []);
}

export const CrispButton = (props: ButtonProps) => (
  <Button {...props} onClick={() => Crisp.chat.open()}>
    {props.children}
  </Button>
);
