import type { Prisma } from "@prisma/client";
import { type ActionFunctionArgs, data } from "react-router";
import { sendFeedbackEmail } from "~/emails/feedback/feedback-email";
import { feedbackSchema } from "~/modules/feedback/schema";
import { getSelectedOrganization } from "~/modules/organization/context.server";
import { getUserByID } from "~/modules/user/service.server";
import { DEFAULT_MAX_IMAGE_UPLOAD_SIZE } from "~/utils/constants";
import { dateTimeInUnix } from "~/utils/date-time-in-unix";
import { makeShelfError } from "~/utils/error";
import { assertIsPost, error, parseData, payload } from "~/utils/http.server";
import { getPublicFileURL, parseFileFormData } from "~/utils/storage.server";

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    // Validate text fields before uploading the screenshot to avoid
    // orphaned files in storage when validation fails
    const clonedRequest = request.clone();
    const rawFormData = await clonedRequest.formData();
    const { type, message } = parseData(rawFormData, feedbackSchema);

    const [user, { currentOrganization }] = await Promise.all([
      getUserByID(userId, {
        select: {
          firstName: true,
          lastName: true,
          username: true,
          email: true,
        } satisfies Prisma.UserSelect,
      }),
      getSelectedOrganization({ userId, request }),
    ]);

    const formData = await parseFileFormData({
      request,
      newFileName: `feedback/${userId}/${dateTimeInUnix(Date.now())}`,
      bucketName: "files",
      maxFileSize: DEFAULT_MAX_IMAGE_UPLOAD_SIZE,
    });

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

    const organizationName = currentOrganization?.name || "Unknown";

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
