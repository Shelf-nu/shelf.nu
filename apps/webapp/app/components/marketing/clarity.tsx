import { useEffect } from "react";
import { clarity } from "react-microsoft-clarity";

export const Clarity = () => {
  useEffect(() => {
    if (window && window.env.MICROSOFT_CLARITY_ID) {
      clarity.init(window.env.MICROSOFT_CLARITY_ID);
    }
  }, []);
  return <></>;
};
