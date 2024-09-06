import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { NotificationIcon } from "~/atoms/notifications";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { data, error, parseData } from "~/utils/http.server";

export const ClientNotificationSchema = z.object({
  title: z.string().min(4, { message: "Title is required" }),
  message: z
    .string()
    .min(10, { message: "Message is required" })
    .optional()
    .nullable(),
  icon: z.custom<NotificationIcon>(),
});

export async function action({ context, request }: LoaderFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    const payload = parseData(await request.json(), ClientNotificationSchema);

    const { title, message, icon } = payload;

    sendNotification({
      title,
      message,
      icon,
      senderId: authSession.userId,
    });

    return json(data({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return json(error(reason), { status: reason.status });
  }
}
