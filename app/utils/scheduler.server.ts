import PgBoss from "pg-boss";
import { DIRECT_URL, NODE_ENV } from "../utils/env";

let scheduler!: PgBoss;

declare global {
  var scheduler: PgBoss;
}

export const init = async () => {
  if (!scheduler) {
    if (NODE_ENV === "production") {
      scheduler = new PgBoss(DIRECT_URL);
    } else {
      if (!global.scheduler) {
        global.scheduler = new PgBoss(DIRECT_URL);
      }
      scheduler = global.scheduler;
    }
    await scheduler.start();
  }
  return;
};

export { scheduler };
