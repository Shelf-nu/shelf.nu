import type { Prisma } from "@prisma/client";
import { type ActionFunctionArgs, data } from "react-router";
import { z } from "zod";
import { sendFeedbackEmail } from "~/emails/feedback/feedback-email";
import { getUserByID } from "~/modules/user/service.server";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import { getPublicFileURL, parseFileFormData } from "~/utils/storage.server";

export const feedbackSchema = z.object({
  type: z.enum(["issue", "idea"]),
  message: z
    .string()
    .min(10, "Please provide at least 10 characters")
    .max(5000, "Message is too long"),
});

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    const user = await getUserByID(userId, {
      include: {
        userOrganizations: {
          where: { userId },
          select: {
            organization: { select: { name: true } },
          },
          take: 1,
        },
      },
    } satisfies { include: Prisma.UserInclude });

    const formData = await parseFileFormData({
      request,
      newFileName: `feedback/${userId}/${dateTimeInUnix(Date.now())}`,
      bucketName: "files",
      maxFileSize: 4_000_000,
    });

    const { type, message } = parseData(formData, feedbackSchema);

    const screenshotPath = formData.get("screenshot") as string | null;
    const screenshotUrl =
      screenshotPath && screenshotPath !== ""
        ? getPublicFileURL({
            filename: screenshotPath,
            bucketName: "files",
          })
        : null;

    const userName =
      [user.firstName, user.lastName].filter(Boolean).join(" ") ||
      user.username ||
      "Unknown user";

    const organizationName =
      user.userOrganizations?.[0]?.organization?.name || "Unknown";

    await sendFeedbackEmail({
      userName,
      userEmail: user.email,
      organizationName,
      type,
      message,
      screenshotUrl,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
