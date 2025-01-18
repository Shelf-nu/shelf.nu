import PgBoss from "pg-boss";
import { DATABASE_URL, NODE_ENV } from "../utils/env";

export enum QueueNames {
  emailQueue = "email-queue",
  bookingQueue = "booking-queue",
}

let scheduler!: PgBoss;

declare global {
  var scheduler: PgBoss;
}

export const init = async () => {
  if (!scheduler) {
    const url = DATABASE_URL.split("?")[0];
    const commonAttributes = {
      connectionString: url,
      newJobCheckIntervalSeconds: 60 * 5,
      noScheduling: true, //need to remove it, if we use cron schedulers in the future, but it comes with a cost of 2 additional polling every minute
    };

    if (NODE_ENV === "production") {
      scheduler = new PgBoss({
        max: 4,
        ...commonAttributes,
      });
    } else {
      if (!global.scheduler) {
        global.scheduler = new PgBoss({
          max: 1,
          ...commonAttributes,
        });
      }
      scheduler = global.scheduler;
    }
    await scheduler.start();
  }
  return;
};

export { scheduler };
