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

interface FeedbackEmailProps {
  userName: string;
  userEmail: string;
  organizationName: string;
  type: "issue" | "idea";
  message: string;
  screenshotUrl?: string | null;
}

export const sendFeedbackEmail = async ({
  userName,
  userEmail,
  organizationName,
  type,
  message,
  screenshotUrl,
}: FeedbackEmailProps) => {
  try {
    const typeLabel = type === "issue" ? "Issue" : "Idea";
    const subjectPreview =
      message.length > 50 ? `${message.slice(0, 50)}...` : message;
    const subject = `New feedback [${typeLabel}]: ${subjectPreview}`;

    const html = await feedbackEmailHtml({
      userName,
      userEmail,
      organizationName,
      type,
      message,
      screenshotUrl,
    });

    const text = feedbackEmailText({
      userName,
      userEmail,
      organizationName,
      type,
      message,
      screenshotUrl,
    });

    void sendEmail({
      to: SUPPORT_EMAIL,
      subject,
      html,
      text,
      replyTo: userEmail,
    });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Something went wrong while sending the feedback email",
        additionalData: { userEmail, type },
        label: "Email",
      })
    );
  }
};

export const feedbackEmailText = ({
  userName,
  userEmail,
  organizationName,
  type,
  message,
  screenshotUrl,
}: FeedbackEmailProps) => {
  const typeLabel = type === "issue" ? "Issue" : "Idea";

  return `New feedback received

Type: ${typeLabel}
From: ${userName} (${userEmail})
Organization: ${organizationName}

Message:
${message}
${screenshotUrl ? `\nScreenshot: ${screenshotUrl}` : ""}
`;
};

function FeedbackEmailTemplate({
  userName,
  userEmail,
  organizationName,
  type,
  message,
  screenshotUrl,
}: FeedbackEmailProps) {
  const typeLabel = type === "issue" ? "Issue" : "Idea";
  const typeBgColor = type === "issue" ? "#FEE2E2" : "#DBEAFE";
  const typeBorderColor = type === "issue" ? "#FECACA" : "#BFDBFE";
  const typeTextColor = type === "issue" ? "#991B1B" : "#1E40AF";

  return (
    <Html>
      <Head>
        <title>New feedback received</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.h2 }}>New feedback received</Text>

          <div
            style={{
              backgroundColor: "#F9FAFB",
              border: "1px solid #E5E7EB",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
            <Text
              style={{
                ...styles.p,
                margin: "0 0 8px 0",
                fontSize: "14px",
                color: "#6B7280",
              }}
            >
              <strong>Type:</strong>{" "}
              <span
                style={{
                  backgroundColor: typeBgColor,
                  border: `1px solid ${typeBorderColor}`,
                  color: typeTextColor,
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontSize: "13px",
                  fontWeight: "600",
                }}
              >
                {typeLabel}
              </span>
            </Text>
            <Text
              style={{
                ...styles.p,
                margin: "0 0 4px 0",
                fontSize: "14px",
                color: "#6B7280",
              }}
            >
              <strong>From:</strong>{" "}
              <Link href={`mailto:${userEmail}`} style={{ color: "#2563EB" }}>
                {userName}
              </Link>{" "}
              ({userEmail})
            </Text>
            <Text
              style={{
                ...styles.p,
                margin: "0",
                fontSize: "14px",
                color: "#6B7280",
              }}
            >
              <strong>Organization:</strong> {organizationName}
            </Text>
          </div>

          <Text style={{ ...styles.p, fontWeight: "600" }}>Message:</Text>
          <div
            style={{
              backgroundColor: "#FFFFFF",
              border: "1px solid #E5E7EB",
              borderRadius: "8px",
              padding: "16px",
              marginBottom: "16px",
            }}
          >
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
        </div>
      </Container>
    </Html>
  );
}

export const feedbackEmailHtml = (props: FeedbackEmailProps) =>
  render(<FeedbackEmailTemplate {...props} />);
