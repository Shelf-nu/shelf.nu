import PgBoss from "pg-boss";
import { DATABASE_URL } from "../utils/env";

let scheduler!: PgBoss;

if (!scheduler) {
  scheduler = new PgBoss(DATABASE_URL);
  scheduler.start();
}

export { scheduler };
