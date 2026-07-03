import {
  Container,
  Head,
  Html,
  Link,
  render,
  Text,
} from "@react-email/components";
import parser from "ua-parser-js";
import type { FeedbackErrorContext } from "~/modules/feedback/schema";
import { SERVER_URL, SUPPORT_EMAIL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { LogoForEmail } from "../logo";
import { sendEmail } from "../mail.server";
import { styles } from "../styles";

interface FeedbackEmailProps {
  userName: string;
  userEmail: string;
  /** Shelf user id, for looking the reporter up in the admin dashboard */
  userId?: string | null;
  organizationName: string;
  organizationId?: string | null;
  type: "issue" | "idea";
  message: string;
  screenshotUrl?: string | null;
  /** URL of the page the feedback was submitted from */
  currentUrl?: string | null;
  /** Browser user agent, captured server-side from the request */
  userAgent?: string | null;
  /** Browser viewport, e.g. "1512x824 @2x" */
  viewport?: string | null;
  /** Deployed app version ("dev" outside production) */
  appVersion?: string | null;
  /** Present when the report was started from an error page */
  errorContext?: FeedbackErrorContext | null;
}

/** A label/value line in one of the email's info boxes */
type DetailRow = { label: string; value: string; href?: string };

/**
 * Emails a user-submitted feedback entry (issue/idea/error report) to
 * SUPPORT_EMAIL with reply-to set to the submitter. Fire-and-forget:
 * failures are logged, never surfaced to the user.
 */
export const sendFeedbackEmail = async (props: FeedbackEmailProps) => {
  try {
    const { message, userEmail, type, errorContext } = props;
    const typeLabel = getTypeLabel(type, errorContext);
    const sanitized = message.replace(/[\r\n\t]+/g, " ").trim();
    const subjectPreview =
      sanitized.length > 50 ? `${sanitized.slice(0, 50)}...` : sanitized;
    const subject = `New feedback [${typeLabel}]: ${subjectPreview}`;

    const html = await feedbackEmailHtml(props);
    const text = feedbackEmailText(props);

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
        additionalData: { userEmail: props.userEmail, type: props.type },
        label: "Email",
      })
    );
  }
};

/**
 * Label used in the subject and the type badge. Reports coming from an error
 * page are flagged as "Error report" so support can triage them first.
 */
function getTypeLabel(
  type: FeedbackEmailProps["type"],
  errorContext?: FeedbackErrorContext | null
) {
  if (errorContext) {
    return "Error report";
  }
  return type === "issue" ? "Issue" : "Idea";
}

/**
 * Renders a user agent as "Chrome 126 on macOS", far more scannable than
 * the raw UA string; falls back to the raw string when unparseable.
 */
function formatUserAgent(userAgent: string) {
  const ua = parser(userAgent);
  const browser = [ua.browser.name, ua.browser.version]
    .filter(Boolean)
    .join(" ");
  const os = [ua.os.name, ua.os.version].filter(Boolean).join(" ");
  if (!browser) {
    return userAgent;
  }
  return os ? `${browser} on ${os}` : browser;
}

/** Rows for the auto-captured context section, in display order */
function getContextRows({
  currentUrl,
  appVersion,
  userAgent,
  viewport,
  organizationId,
  userId,
}: FeedbackEmailProps): DetailRow[] {
  const rows: DetailRow[] = [];

  if (currentUrl) {
    /* The URL is client-supplied: only make it clickable when it points at
     * our own app, so a crafted submission can't plant a phishing link in
     * the support inbox. Off-origin values still show as plain text. */
    const isAppUrl = currentUrl.startsWith(SERVER_URL);
    rows.push({
      label: "Page",
      value: currentUrl,
      ...(isAppUrl ? { href: currentUrl } : {}),
    });
  }
  if (appVersion) {
    rows.push({ label: "App version", value: appVersion });
  }
  if (userAgent) {
    rows.push({ label: "Browser", value: formatUserAgent(userAgent) });
  }
  if (viewport) {
    rows.push({ label: "Viewport", value: viewport });
  }
  if (organizationId) {
    rows.push({ label: "Organization id", value: organizationId });
  }
  if (userId) {
    rows.push({ label: "User id", value: userId });
  }

  return rows;
}

/** Rows for the error-details section, in display order */
function getErrorRows(errorContext?: FeedbackErrorContext | null): DetailRow[] {
  if (!errorContext) {
    return [];
  }

  const rows: DetailRow[] = [];

  if (errorContext.errorStatus) {
    rows.push({ label: "Status", value: errorContext.errorStatus });
  }
  if (errorContext.errorTitle) {
    rows.push({ label: "Title", value: errorContext.errorTitle });
  }
  if (errorContext.errorMessage) {
    rows.push({ label: "Message", value: errorContext.errorMessage });
  }
  if (errorContext.traceId) {
    rows.push({ label: "Trace id", value: errorContext.traceId });
  }
  if (errorContext.sentryEventId) {
    rows.push({ label: "Sentry event id", value: errorContext.sentryEventId });
  }

  return rows;
}

/** Plain-text rendering of the feedback email (mirrors the HTML version) */
export const feedbackEmailText = (props: FeedbackEmailProps) => {
  const {
    userName,
    userEmail,
    organizationName,
    type,
    message,
    screenshotUrl,
    errorContext,
  } = props;
  const typeLabel = getTypeLabel(type, errorContext);
  const contextRows = getContextRows(props);
  const errorRows = getErrorRows(errorContext);

  const contextBlock = contextRows.length
    ? `\n${contextRows.map((row) => `${row.label}: ${row.value}`).join("\n")}\n`
    : "";

  const errorBlock = errorRows.length
    ? `\nError details:\n${errorRows
        .map((row) => `${row.label}: ${row.value}`)
        .join("\n")}\n`
    : "";

  return `New feedback received

Type: ${typeLabel}
From: ${userName} (${userEmail})
Organization: ${organizationName}
${contextBlock}
Message:
${message}
${errorBlock}${screenshotUrl ? `\nScreenshot: ${screenshotUrl}` : ""}
`;
};

/** Shared style for the small gray label/value rows in info boxes */
const detailRowStyle = {
  ...styles.p,
  margin: "0 0 4px 0",
  fontSize: "14px",
  color: "#6B7280",
} as const;

/** Gray info box used for the sender and context sections */
const infoBoxStyle = {
  backgroundColor: "#F9FAFB",
  border: "1px solid #E5E7EB",
  borderRadius: "8px",
  padding: "16px",
  marginBottom: "16px",
} as const;

/** White box holding the user's message */
const messageBoxStyle = {
  ...infoBoxStyle,
  backgroundColor: "#FFFFFF",
} as const;

/** Red-tinted box holding the error details of an error report */
const errorBoxStyle = {
  ...infoBoxStyle,
  backgroundColor: "#FEF2F2",
  border: "1px solid #FECACA",
} as const;

/** Renders label/value rows; links the value when a href is provided */
function DetailRows({ rows, color }: { rows: DetailRow[]; color?: string }) {
  return (
    <>
      {rows.map((row) => (
        <Text
          key={row.label}
          style={{ ...detailRowStyle, ...(color ? { color } : {}) }}
        >
          <strong>{row.label}:</strong>{" "}
          {row.href ? (
            <Link href={row.href} style={{ color: "#2563EB" }}>
              {row.value}
            </Link>
          ) : (
            row.value
          )}
        </Text>
      ))}
    </>
  );
}

function FeedbackEmailTemplate(props: FeedbackEmailProps) {
  const {
    userName,
    userEmail,
    organizationName,
    type,
    message,
    screenshotUrl,
    errorContext,
  } = props;
  const typeLabel = getTypeLabel(type, errorContext);
  const isErrorReport = Boolean(errorContext);
  const showAsIssue = type === "issue" || isErrorReport;
  const typeBgColor = showAsIssue ? "#FEE2E2" : "#DBEAFE";
  const typeBorderColor = showAsIssue ? "#FECACA" : "#BFDBFE";
  const typeTextColor = showAsIssue ? "#991B1B" : "#1E40AF";
  const contextRows = getContextRows(props);
  const errorRows = getErrorRows(errorContext);

  return (
    <Html>
      <Head>
        <title>New feedback received</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.h2 }}>New feedback received</Text>

          <div style={infoBoxStyle}>
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
            <Text style={detailRowStyle}>
              <strong>From:</strong>{" "}
              <Link href={`mailto:${userEmail}`} style={{ color: "#2563EB" }}>
                {userName}
              </Link>{" "}
              ({userEmail})
            </Text>
            <Text style={{ ...detailRowStyle, margin: "0" }}>
              <strong>Organization:</strong> {organizationName}
            </Text>
          </div>

          {contextRows.length > 0 ? (
            <div style={infoBoxStyle}>
              <DetailRows rows={contextRows} />
            </div>
          ) : null}

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

          {errorRows.length > 0 ? (
            <>
              <Text style={{ ...styles.p, fontWeight: "600" }}>
                Error details:
              </Text>
              <div style={errorBoxStyle}>
                <DetailRows rows={errorRows} color="#991B1B" />
              </div>
            </>
          ) : null}

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
