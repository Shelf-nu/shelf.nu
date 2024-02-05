import PgBoss from "pg-boss";
import { DIRECT_URL, NODE_ENV } from "../utils/env";

let scheduler!: PgBoss;

declare global {
  // eslint-disable-next-line no-var
  var scheduler: PgBoss;
}

let isInit = false;
export const init = async () => {
  try {
    if (!scheduler) {
      if (NODE_ENV === "production") {
        scheduler = new PgBoss(DIRECT_URL);
      } else {
        if (!global.scheduler) {
          global.scheduler = new PgBoss(DIRECT_URL);
        }
        scheduler = global.scheduler;
      }

      if (isInit) {
        return;
      }

      await scheduler.start();
      isInit = true;
    }
    return;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e);
  }
};

init();

export { scheduler };
