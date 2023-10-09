import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { parseFormAny } from "react-zorm";
import { z } from "zod";
import type { NotificationIcon } from "~/atoms/notifications";
import { requireAuthSession } from "~/modules/auth";
import { sendNotification } from "~/utils/emitter/send-notification.server";

export const ClientNotificationSchema = z.object({
  title: z.string().min(4, { message: "Title is required" }),
  message: z.string().min(10, { message: "Message is required" }),
  icon: z.custom<NotificationIcon>(),
});

export async function action({ request }: LoaderFunctionArgs) {
  const authSession = await requireAuthSession(request);

  const formData = await request.formData();
  const result = await ClientNotificationSchema.safeParseAsync(
    parseFormAny(formData)
  );

  if (!result.success) {
    return json({ error: result.error.message }, { status: 400 });
  }
  const { title, message, icon } = result.data;

  sendNotification({
    title,
    message,
    icon,
    senderId: authSession.userId,
  });

  return json({ success: true });
}
