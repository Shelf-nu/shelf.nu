import PgBoss from "pg-boss";
import { DATABASE_URL } from "../utils/env";

let scheduler!: PgBoss;

export const init = async () => {
  if (!scheduler) {
    scheduler = new PgBoss(DATABASE_URL);
    await scheduler.start();
  }
  return;
};

export { scheduler };
