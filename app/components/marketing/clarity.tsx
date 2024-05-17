import { useEffect } from "react";
import { clarity } from "react-microsoft-clarity";
import { NODE_ENV } from "~/utils/env";

export const Clarity = () => {
  useEffect(() => {
    if (
      window &&
      window.env.MICROSOFT_CLARITY_ID &&
      NODE_ENV === "production"
    ) {
      clarity.init(window.env.MICROSOFT_CLARITY_ID);
    }
  }, []);
  return <></>;
};
