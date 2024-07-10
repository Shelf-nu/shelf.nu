import type { CookieOptions } from "@remix-run/node";
import { createSessionStorage } from "@remix-run/node";
import { z } from "zod";
import { db } from "~/database/db.server";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string;
  expiresIn: number;
  expiresAt: number;
};

export const authSessionKey = "auth";

export type SessionData = {
  [authSessionKey]: AuthSession;
};

export type FlashData = { errorMessage: string };

/** Creates a session storage */
// export function createSessionStorage() {
//   return createCookieSessionStorage({
//     cookie: {
//       name: "__authSession",
//       httpOnly: true,
//       path: "/",
//       sameSite: "lax",
//       secrets: [env.SESSION_SECRET],
//       secure: env.NODE_ENV === "production",
//     },
//   });
// }

const sessionSchema = z
  .object({
    auth: z.object({
      email: z.string(),
      userId: z.string(),
      expiresAt: z.number(),
      expiresIn: z.number(),
      accessToken: z.string(),
      refreshToken: z.string(),
    }),
  })
  .partial();

export function createDatabaseSessionStorage({
  cookie,
}: {
  cookie: CookieOptions & {
    name?: string;
  };
}) {
  return createSessionStorage<SessionData, FlashData>({
    cookie,
    async createData(data, expires) {
      const parsedData = sessionSchema.parse(data);
      const createdSession = await db.session.create({
        data: { data: parsedData, expires, userId: parsedData.auth?.userId },
      });
      return createdSession.id;
    },
    async readData(id) {
      const data = await db.session.findFirst({ where: { id } });
      return sessionSchema.parse(data?.data ?? {});
    },
    async updateData(id, data, expires) {
      const parsedData = sessionSchema.parse(data);

      await db.session.update({
        where: { id },
        data: { data: parsedData, expires, userId: parsedData.auth?.userId },
      });
    },
    async deleteData(id) {
      await db.session.delete({ where: { id } });
    },
  });
}
