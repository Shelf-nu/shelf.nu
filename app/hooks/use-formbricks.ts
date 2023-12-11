import { useEffect } from "react";
//@ts-ignore
//as formbricks has TS issues which they will be resolving later on
import formbricks from "@formbricks/js";
import { FORMBRICKS_ENV_ID, NODE_ENV } from "~/utils";

export function useFormbricks() {
  useEffect(() => {
    if (window && FORMBRICKS_ENV_ID) {
      formbricks.init({
        environmentId: FORMBRICKS_ENV_ID,
        apiHost: "https://app.formbricks.com",
        debug: NODE_ENV === "development",
      });
    }
  }, []);
}
