// import PgBoss from "pg-boss";
// import { DATABASE_URL, NODE_ENV } from "../utils/env";

// let scheduler!: PgBoss;

// declare global {
//   // eslint-disable-next-line no-var
//   var scheduler: PgBoss;
// }

// export const init = async () => {
//   if (!scheduler) {
//     if (NODE_ENV === "production") {
//       scheduler = new PgBoss(DATABASE_URL);
//     } else {
//       if (!global.scheduler) {
//         global.scheduler = new PgBoss(DATABASE_URL);
//       }
//       scheduler = global.scheduler;
//     }
//     await scheduler.start();
//   }
//   return;
// };

// export { scheduler };

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
