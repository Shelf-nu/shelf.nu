import { data, type LoaderFunctionArgs } from "@remix-run/node";
import { z } from "zod";
import type { NotificationIcon } from "~/atoms/notifications";
import { sendNotification } from "~/utils/emitter/send-notification.server";
import { makeShelfError } from "~/utils/error";
import { payload, error, parseData } from "~/utils/http.server";

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
    const parsedData = parseData(
      await request.json(),
      ClientNotificationSchema
    );

    const { title, message, icon } = parsedData;

    sendNotification({
      title,
      message,
      icon,
      senderId: authSession.userId,
    });

    return payload({ success: true });
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
