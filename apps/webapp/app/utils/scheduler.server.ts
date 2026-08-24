import PgBoss from "pg-boss";
import { ShelfError } from "./error";
import { Logger } from "./logger";
import { DATABASE_URL, NODE_ENV } from "../utils/env";

export enum QueueNames {
  emailQueue = "email-queue",
  bookingQueue = "booking-queue",
  auditQueue = "audit-queue",
  assetsQueue = "assets-queue",
  addonTrialQueue = "addon-trial-queue",
}

let pgBossInstance!: PgBoss;

declare global {
  // Renamed from `scheduler` to avoid conflict with the built-in
  // Web Scheduling API type added in TypeScript 6 / ES2025.
  var pgBossScheduler: PgBoss;
}

export const init = async () => {
  if (!pgBossInstance) {
    const url = DATABASE_URL.split("?")[0];
    const commonAttributes = {
      connectionString: url,
      newJobCheckIntervalSeconds: 60 * 5,
      noScheduling: true, //need to remove it, if we use cron schedulers in the future, but it comes with a cost of 2 additional polling every minute
    };

    if (NODE_ENV === "production") {
      pgBossInstance = new PgBoss({
        max: 4,
        ...commonAttributes,
      });
    } else {
      if (!global.pgBossScheduler) {
        global.pgBossScheduler = new PgBoss({
          max: 1,
          ...commonAttributes,
        });
      }
      pgBossInstance = global.pgBossScheduler;
    }

    // Register an error handler before starting. PgBoss extends EventEmitter and
    // re-emits worker/maintenance failures (e.g. transient EAUTHTIMEOUT / 08006)
    // as 'error' events. An unhandled 'error' event on an EventEmitter throws and
    // crashes the Node process (the SHELF-WEBAPP-1KJ / 21E production crashes and
    // subsequent machine restarts). Logging it keeps the process alive.
    //
    // why the listenerCount guard: in dev the instance is a surviving `global`
    // while the `!pgBossInstance` guard above is on a module-local that resets on
    // every Vite hot reload, so init() re-runs against the same instance. Without
    // this guard each reload attaches another listener (MaxListenersExceededWarning
    // + duplicate logs). Attaching only when none exists is idempotent.
    if (pgBossInstance.listenerCount("error") === 0) {
      pgBossInstance.on("error", (cause: unknown) => {
        Logger.error(
          new ShelfError({
            cause,
            message: "pg-boss worker error",
            label: "Scheduler",
            shouldBeCaptured: true,
          })
        );
      });
    }

    await pgBossInstance.start();
  }
  return;
};

export { pgBossInstance as scheduler };
