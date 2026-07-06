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

/**
 * Screenshots are bounded on BOTH dimensions (fit "inside" preserves the
 * aspect ratio). A width-only bound would let a very tall full-page capture
 * scale past WebP's 16383px dimension limit and crash the whole submission.
 * 1920 (not the 1200 used for entity photos) because screenshots are
 * text-dense and need to stay readable.
 */
const SCREENSHOT_MAX_DIMENSION = 1920;

/**
 * Query params with secret-looking names are redacted before the page URL
 * reaches the support email. Mirrors SENSITIVE_KEY_PATTERN in
 * server/instrument.server.ts (which is private to that module), plus `otp`
 * which shows up in URLs. Deliberately no bare `code`/`key`: those would
 * false-positive on legitimate filter params like `barcode`.
 */
const SENSITIVE_QUERY_PARAM =
  /token|password|secret|verifier|cookie|authorization|credential|jwt|api[-_]?key|otp/i;

/** Redacts secret-looking query param values; passes unparseable input through */
function redactSensitiveSearchParams(href: string | undefined) {
  if (!href) {
    return href;
  }
  try {
    const url = new URL(href);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAM.test(key)) {
        url.searchParams.set(key, "redacted");
      }
    }
    return url.toString();
  } catch {
    return href;
  }
}

export async function action({ context, request }: ActionFunctionArgs) {
  const authSession = context.getSession();
  const { userId } = authSession;

  try {
    assertIsPost(request);

    // Validate text fields before uploading the screenshot to avoid
    // orphaned files in storage when validation fails
    const clonedRequest = request.clone();
    const rawFormData = await clonedRequest.formData();
    const { type, message, currentUrl, viewport, ...errorContext } = parseData(
      rawFormData,
      feedbackSchema
    );

    const [user, { currentOrganization }] = await Promise.all([
      getUserByID(userId, {
        select: {
          firstName: true,
          lastName: true,
          displayName: true,
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
      // Without this, cropImage falls back to its 150x150 avatar-thumbnail
      // default and screenshots arrive unreadable in the support email
      resizeOptions: {
        width: SCREENSHOT_MAX_DIMENSION,
        height: SCREENSHOT_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      },
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
      userId,
      organizationName,
      organizationId: currentOrganization?.id,
      type,
      message,
      screenshotUrl,
      currentUrl: redactSensitiveSearchParams(currentUrl),
      viewport,
      // The user agent is read server-side so it can't drift from the
      // browser that actually submitted the report
      userAgent: request.headers.get("user-agent"),
      appVersion: context.appVersion,
      errorContext: Object.values(errorContext).some(Boolean)
        ? errorContext
        : null,
    });

    return data(payload({ success: true }));
  } catch (cause) {
    const reason = makeShelfError(cause, { userId });
    return data(error(reason), { status: reason.status });
  }
}
