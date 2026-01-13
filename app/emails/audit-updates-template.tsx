import {
  Button,
  Html,
  Head,
  render,
  Container,
  Heading,
} from "@react-email/components";
import type { ClientHint } from "~/utils/client-hints";
import { getDateTimeFormatFromHints } from "~/utils/client-hints";
import { SERVER_URL } from "~/utils/env";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

/**
 * Audit session data for email template
 * Based on the structure used in audit service
 */
export interface AuditForEmail {
  id: string;
  name: string;
  description?: string | null;
  dueDate?: Date | null;
  organizationId: string;
  organization: {
    name: string;
    owner: {
      email: string;
    };
  };
  _count: {
    assets: number;
  };
  createdBy: {
    firstName: string | null;
    lastName: string | null;
  };
}

interface Props {
  heading: string;
  audit: AuditForEmail;
  assetCount: number;
  hints: ClientHint;
  hideViewButton?: boolean;
  isAdminEmail?: boolean;
  completedAt?: Date;
  wasOverdue?: boolean;
}

/**
 * Email template for audit-related notifications
 * Matches the pattern of bookings-updates-template.tsx
 */
export function AuditUpdatesEmailTemplate({
  audit,
  heading,
  hints,
  assetCount,
  hideViewButton = false,
  isAdminEmail = false,
  completedAt,
  wasOverdue,
}: Props) {
  const creatorName = `${audit.createdBy.firstName || "Unknown"} ${
    audit.createdBy.lastName || "User"
  }`;

  const dueDateFormatted = audit.dueDate
    ? getDateTimeFormatFromHints(hints, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(audit.dueDate as Date)
    : null;

  return (
    <Html>
      <Head>
        <title>Audit update from Shelf.nu</title>
      </Head>

      <Container
        style={{ padding: "32px 16px", textAlign: "center", maxWidth: "100%" }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            marginBottom: "32px",
          }}
        >
          <LogoForEmail />
        </div>
        <div style={{ margin: "32px" }}>
          <Heading as="h1" style={{ ...styles.h1 }}>
            {heading}
          </Heading>
          <Heading as="h2" style={{ ...styles.h2 }}>
            {audit.name} | {assetCount} {assetCount === 1 ? "asset" : "assets"}
          </Heading>
          <p style={{ ...styles.p }}>
            <span style={{ color: "#101828", fontWeight: "600" }}>
              Created by:
            </span>{" "}
            {creatorName}
          </p>
          {dueDateFormatted && (
            <p style={{ ...styles.p }}>
              <span style={{ color: "#101828", fontWeight: "600" }}>
                Due date:
              </span>{" "}
              {dueDateFormatted}
            </p>
          )}
          {completedAt && (
            <p style={{ ...styles.p }}>
              <span style={{ color: "#101828", fontWeight: "600" }}>
                Completed on:
              </span>{" "}
              {getDateTimeFormatFromHints(hints, {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(completedAt)}
              {wasOverdue && (
                <span style={{ color: "#D92D20", marginLeft: "8px" }}>⚠️</span>
              )}
              {!wasOverdue && dueDateFormatted && (
                <span style={{ color: "#12B76A", marginLeft: "8px" }}>✅</span>
              )}
            </p>
          )}
          {audit.description && (
            <p style={{ ...styles.p }}>
              <span style={{ color: "#101828", fontWeight: "600" }}>
                Description:
              </span>{" "}
              {audit.description}
            </p>
          )}
        </div>

        {!hideViewButton && (
          <Button
            href={`${SERVER_URL}/audits/${audit.id}?orgId=${audit.organizationId}`}
            style={{
              ...styles.button,
              textAlign: "center",
              marginBottom: "32px",
            }}
          >
            View audit in app
          </Button>
        )}

        <div
          style={{
            marginTop: "32px",
            paddingTop: "32px",
            borderTop: "1px solid #E4E4E7",
          }}
        >
          {isAdminEmail ? (
            <p
              style={{
                ...styles.p,
                marginBottom: "16px",
                fontSize: "14px",
                color: "#344054",
              }}
            >
              This email was sent to you because you are the OWNER or ADMIN of
              the workspace{" "}
              <span style={{ color: "#101828", fontWeight: "600" }}>
                "{audit.organization.name}"
              </span>
              . <br /> If you think you weren't supposed to have received this
              email please contact support.
            </p>
          ) : (
            <p
              style={{
                ...styles.p,
                marginBottom: "16px",
                fontSize: "14px",
                color: "#71717A",
              }}
            >
              Thanks,
              <br />
              The Shelf Team
            </p>
          )}
          <p
            style={{
              ...styles.p,
              marginBottom: "32px",
              fontSize: "14px",
              color: "#344054",
            }}
          >
            © {new Date().getFullYear()} Shelf.nu
          </p>
        </div>
      </Container>
    </Html>
  );
}

/**
 * The HTML content of an email will be accessed by a server file to send email.
 * We cannot import a TSX component in a server file so we are exporting TSX
 * converted to HTML string using render function by react-email.
 */
export const auditUpdatesTemplateString = ({
  audit,
  heading,
  hints,
  assetCount,
  hideViewButton = false,
  isAdminEmail = false,
  completedAt,
  wasOverdue,
}: Props) =>
  render(
    <AuditUpdatesEmailTemplate
      audit={audit}
      heading={heading}
      hints={hints}
      assetCount={assetCount}
      hideViewButton={hideViewButton}
      isAdminEmail={isAdminEmail}
      completedAt={completedAt}
      wasOverdue={wasOverdue}
    />
  );
