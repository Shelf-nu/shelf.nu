/**
 * POST /api/mobile/push-token
 * DELETE /api/mobile/push-token
 *
 * Registers or forgets the companion app on this device for push
 * notifications. Device tokens belong to a person, not a workspace, so only
 * the bearer token is checked.
 *
 * - `POST { token, platform, deviceName?, appVersion? }` records the device
 *   for the caller. A token another person registered moves to the caller (a
 *   shared phone, a new sign-in) and a disabled one is revived. Repeating it
 *   refreshes `lastSeenAt`.
 * - `DELETE { token }` forgets the device on sign-out. Answers 404 when the
 *   caller has no such token, including when it belongs to someone else.
 *
 * Both answer `{ ok: true }` on success.
 *
 * @see {@link file://../../../modules/push/service.server.ts}
 */
import { Expo } from "expo-server-sdk";
import { data, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { requireMobileAuth } from "~/modules/api/mobile-auth.server";
import { parseMobileBody } from "~/modules/api/mobile-body.server";
import {
  registerPushToken,
  unregisterPushToken,
} from "~/modules/push/service.server";
import { makeShelfError, notAllowedMethod } from "~/utils/error";
import { getActionMethod, logException } from "~/utils/http.server";

/** A token `getExpoPushTokenAsync` returns, by the Expo SDK's own test. */
const ExpoPushTokenSchema = z
  .string()
  .max(255)
  .refine(Expo.isExpoPushToken, "Expected an Expo push token.");

/** POST body: the device to register for the signed-in person. */
const RegisterSchema = z.object({
  token: ExpoPushTokenSchema,
  platform: z.enum(["IOS", "ANDROID"]),
  // `expo-device` reports `null` when it cannot name the model
  deviceName: z.string().max(120).nullish(),
  appVersion: z.string().max(20).nullish(),
});

/** DELETE body: the device to forget. */
const UnregisterSchema = z.object({ token: ExpoPushTokenSchema });

/** Registers (POST) or forgets (DELETE) this device for the caller. */
export async function action({ request }: ActionFunctionArgs) {
  try {
    const { user } = await requireMobileAuth(request);
    const method = getActionMethod(request);

    if (method === "POST") {
      const registration = await parseMobileBody(
        RegisterSchema,
        request,
        "Push"
      );
      await registerPushToken({ userId: user.id, ...registration });
      return data({ ok: true });
    }

    if (method === "DELETE") {
      const { token } = await parseMobileBody(
        UnregisterSchema,
        request,
        "Push"
      );
      const removed = await unregisterPushToken({ userId: user.id, token });
      if (!removed) {
        return data(
          { error: { message: "Push token not found." } },
          { status: 404 }
        );
      }
      return data({ ok: true });
    }

    throw notAllowedMethod(method);
  } catch (cause) {
    const reason = makeShelfError(cause);
    logException(reason);
    return data(
      { error: { message: reason.message } },
      { status: reason.status }
    );
  }
}
