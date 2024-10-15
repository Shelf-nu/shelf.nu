import PgBoss from "pg-boss";
import { DATABASE_URL, NODE_ENV } from "../utils/env";

let scheduler!: PgBoss;

declare global {
  var scheduler: PgBoss;
}

export const init = async () => {
  if (!scheduler) {
    const url = DATABASE_URL.split("?")[0];
    if (NODE_ENV === "production") {
      scheduler = new PgBoss({
        max: 4,
        connectionString: url,
      });
    } else {
      if (!global.scheduler) {
        global.scheduler = new PgBoss({
          max: 1,
          connectionString: url,
          newJobCheckIntervalSeconds: 60 * 5,
          noScheduling: true, //need to remove it, if we use cron schedulers in the future, but it comes with a cost of 2 additional polling every minute
        });
      }
      scheduler = global.scheduler;
    }
    await scheduler.start();
  }
  return;
};

export { scheduler };
