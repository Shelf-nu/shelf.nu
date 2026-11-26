/**
 * Problem Report Email
 *
 * Sent to each member of the workspace's problem-report audience
 * (`notifications.problemReports` in the role policy table) when a member uses
 * "Report a problem" on an asset. It names the workspace, the asset and the
 * reporter, quotes what they wrote and links to the asset.
 *
 * Every value in it is plain text: React escapes it in the HTML version, and
 * the plain-text version is not rendered as markup.
 *
 * @see {@link file://../modules/problem-report/service.server.ts} - sender
 */
import {
  Button,
  Container,
  Head,
  Html,
  render,
  Text,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import { SERVER_URL } from "~/utils/env";
import { PROBLEM_REPORT_AUDIENCE } from "~/utils/permissions/role-audience";
import { CustomEmailFooter } from "./components/custom-footer";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

/** One recipient's copy of a problem report. */
export type ProblemReportEmailProps = {
  /** The recipient's first name (or display name) for the greeting, if known. */
  greetingName: string | null;
  /** Where this copy is sent, printed in the footer. */
  recipientEmail: string;
  workspaceName: string;
  assetId: string;
  assetTitle: string;
  /** The reporter's display name. */
  reporterName: string;
  /** What the reporter wrote, already validated by the problem report schema. */
  content: string;
  customEmailFooter?: string | null;
};

/**
 * The subject line, shared by the sender and the tests.
 *
 * @param assetTitle - The asset the report is about
 * @returns e.g. `Problem reported: Camera 4`
 */
export function problemReportSubject(assetTitle: string) {
  return `Problem reported: ${assetTitle}`;
}

/** The asset page the button and the plain-text link open. */
function assetUrl(assetId: string) {
  return `${SERVER_URL}/assets/${assetId}`;
}

function ProblemReportEmailTemplate(props: ProblemReportEmailProps) {
  const { emailPrimaryColor } = config;

  return (
    <Html>
      <Head>
        <title>{problemReportSubject(props.assetTitle)}</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            Hey{props.greetingName ? ` ${props.greetingName}` : ""},
          </Text>

          <Text style={{ ...styles.p }}>
            <strong>{props.reporterName}</strong> reported a problem with{" "}
            <strong>{props.assetTitle}</strong> in{" "}
            <strong>{props.workspaceName}</strong>.
          </Text>

          <Text
            style={{
              ...styles.p,
              backgroundColor: "#FFF8E1",
              border: "1px solid #FFE082",
              borderRadius: "8px",
              padding: "16px",
              whiteSpace: "pre-wrap",
            }}
          >
            {props.content}
          </Text>

          <Text style={{ ...styles.p }}>
            The report is saved in the asset's activity. Reply to this email to
            answer {props.reporterName} directly.
          </Text>

          <Button
            href={assetUrl(props.assetId)}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            View asset
          </Button>

          <Text style={{ marginTop: "24px", ...styles.p }}>
            Thanks, <br />
            The Shelf Team
          </Text>

          <CustomEmailFooter footerText={props.customEmailFooter} />

          <Text style={{ fontSize: "14px", color: "#344054" }}>
            This email was sent to{" "}
            <span style={{ color: emailPrimaryColor }}>
              {props.recipientEmail}
            </span>{" "}
            because {PROBLEM_REPORT_AUDIENCE} of the workspace "
            {props.workspaceName}" receive problem reports.
          </Text>
        </div>
      </Container>
    </Html>
  );
}

/**
 * Renders one recipient's problem report as HTML.
 *
 * @param props - The recipient and the report
 * @returns Promise resolving to the HTML string
 */
export const problemReportEmailHtml = (props: ProblemReportEmailProps) =>
  render(<ProblemReportEmailTemplate {...props} />);

/**
 * Renders one recipient's problem report as plain text.
 *
 * @param props - The recipient and the report
 * @returns The plain-text body
 */
export const problemReportEmailText = (props: ProblemReportEmailProps) => `Hey${
  props.greetingName ? ` ${props.greetingName}` : ""
},

${props.reporterName} reported a problem with ${props.assetTitle} in ${
  props.workspaceName
}.

${props.content}

The report is saved in the asset's activity. Reply to this email to answer ${
  props.reporterName
} directly.

View asset: ${assetUrl(props.assetId)}
${props.customEmailFooter ? `\n---\n${props.customEmailFooter}\n` : ""}
Thanks,
The Shelf Team

This email was sent to ${
  props.recipientEmail
} because ${PROBLEM_REPORT_AUDIENCE} of the workspace "${
  props.workspaceName
}" receive problem reports.
`;
