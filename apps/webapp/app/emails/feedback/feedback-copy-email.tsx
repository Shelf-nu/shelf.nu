/**
 * Feedback copy email
 *
 * Sent to the person who submitted the in-app feedback form: a thank-you
 * with the type they picked, their message and the screenshot link, if any.
 * Replies go to SUPPORT_EMAIL, so anything they add reaches support. The copy
 * invites a reply; it never promises an answer.
 *
 * It shows only what the submitter wrote or attached. The auto-captured
 * context (page, browser, viewport, app version, ids, error details) belongs
 * in the internal support email and must never be added here.
 *
 * @see {@link file://./feedback-email.tsx} - The internal email to support
 * @see {@link file://../../routes/api+/feedback.ts} - Sends both emails
 */
import {
  Container,
  Head,
  Html,
  Link,
  render,
  Text,
} from "@react-email/components";
import { SUPPORT_EMAIL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { LogoForEmail } from "../logo";
import { sendEmail } from "../mail.server";
import { styles } from "../styles";

/** Input for the submitter's copy: only what they wrote or attached */
export interface FeedbackCopyEmailProps {
  /** Name to greet the submitter by; empty greets with a bare "Hey," */
  firstName?: string | null;
  /** The submitter's address; no copy is sent without one */
  userEmail?: string | null;
  type: "issue" | "idea";
  message: string;
  screenshotUrl?: string | null;
}

/** The fields the copy renders, without the address it is sent to */
type FeedbackCopyContent = Omit<FeedbackCopyEmailProps, "userEmail">;

const TYPE_LABELS: Record<FeedbackCopyEmailProps["type"], string> = {
  issue: "Issue",
  idea: "Idea",
};

/**
 * Emails the submitter a copy of the feedback they just sent, with reply-to
 * set to SUPPORT_EMAIL. Fire-and-forget: failures are logged, never surfaced
 * to the user.
 *
 * Sends nothing when the submitter has no address, or when SUPPORT_EMAIL is
 * not configured: the copy invites a reply, and without that address the
 * reply would go to the sender address instead. The copy goes out through
 * `sendEmail` like every other email, so soft-deleted addresses are dropped
 * there.
 */
export const sendFeedbackCopyEmail = async ({
  firstName,
  userEmail,
  type,
  message,
  screenshotUrl,
}: FeedbackCopyEmailProps) => {
  const to = userEmail?.trim();
  if (!to || !SUPPORT_EMAIL) {
    return;
  }

  try {
    /* Rebuilt field by field so nothing beyond these four can reach the
     * templates, even when the caller passes a wider object */
    const content: FeedbackCopyContent = {
      firstName,
      type,
      message,
      screenshotUrl,
    };
    const sanitized = message.replace(/[\r\n\t]+/g, " ").trim();
    const subjectPreview =
      sanitized.length > 50 ? `${sanitized.slice(0, 50)}...` : sanitized;
    const subject = `Thanks for your feedback: ${subjectPreview}`;

    const html = await feedbackCopyEmailHtml(content);
    const text = feedbackCopyEmailText(content);

    void sendEmail({
      to,
      subject,
      html,
      text,
      replyTo: SUPPORT_EMAIL,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Something went wrong while sending the feedback copy email",
        additionalData: { userEmail: to, type },
        label: "Email",
      })
    );
  }
};

/**
 * Plain-text rendering of the copy (mirrors the HTML version).
 *
 * @param props - The submitter's own content
 * @returns The text body handed to `sendEmail`
 */
export const feedbackCopyEmailText = ({
  firstName,
  type,
  message,
  screenshotUrl,
}: FeedbackCopyContent) => `Hey${firstName ? ` ${firstName}` : ""},

Thanks for taking the time to send us feedback. Here is a copy of what you sent.

Type: ${TYPE_LABELS[type]}

Message:
${message}
${screenshotUrl ? `\nScreenshot: ${screenshotUrl}\n` : ""}
We appreciate you helping us improve Shelf. If you want to add anything, reply to this email.

The Shelf Team
`;

/** Gray box holding the type, matching the internal feedback email */
const infoBoxStyle = {
  backgroundColor: "#F9FAFB",
  border: "1px solid #E5E7EB",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "16px",
} as const;

/** White box holding the submitter's message */
const messageBoxStyle = {
  ...infoBoxStyle,
  backgroundColor: "#FFFFFF",
} as const;

/**
 * React Email layout of the copy: greeting, type badge, message, optional
 * screenshot link, the line about replies, and the closing.
 *
 * @param props - The submitter's own content
 */
function FeedbackCopyEmailTemplate({
  firstName,
  type,
  message,
  screenshotUrl,
}: FeedbackCopyContent) {
  const isIssue = type === "issue";

  return (
    <Html>
      <Head>
        <title>Thanks for your feedback</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{firstName ? ` ${firstName}` : ""},
          </Text>

          <Text style={{ ...styles.p }}>
            Thanks for taking the time to send us feedback. Here is a copy of
            what you sent.
          </Text>

          <div style={infoBoxStyle}>
            <Text
              style={{
                ...styles.p,
                margin: "0",
                fontSize: "14px",
                color: "#6B7280",
              }}
            >
              <strong>Type:</strong>{" "}
              <span
                style={{
                  backgroundColor: isIssue ? "#FEE2E2" : "#DBEAFE",
                  border: `1px solid ${isIssue ? "#FECACA" : "#BFDBFE"}`,
                  color: isIssue ? "#991B1B" : "#1E40AF",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                {TYPE_LABELS[type]}
              </span>
            </Text>
          </div>

          <Text style={{ ...styles.p, fontWeight: "600" }}>Message:</Text>
          <div style={messageBoxStyle}>
            <Text
              style={{
                ...styles.p,
                margin: "0",
                whiteSpace: "pre-wrap",
              }}
            >
              {message}
            </Text>
          </div>

          {screenshotUrl ? (
            <Text style={{ ...styles.p }}>
              <strong>Screenshot:</strong>{" "}
              <Link href={screenshotUrl} style={{ color: "#2563EB" }}>
                View screenshot
              </Link>
            </Text>
          ) : null}

          <Text style={{ marginTop: "24px", ...styles.p }}>
            We appreciate you helping us improve Shelf. If you want to add
            anything, reply to this email.
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>The Shelf Team</Text>
        </div>
      </Container>
    </Html>
  );
}

/**
 * Renders the copy to HTML.
 *
 * @param props - The submitter's own content
 * @returns The HTML body handed to `sendEmail`
 */
export const feedbackCopyEmailHtml = (props: FeedbackCopyContent) =>
  render(<FeedbackCopyEmailTemplate {...props} />);
