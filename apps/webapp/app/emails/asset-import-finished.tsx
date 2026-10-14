/**
 * Asset Import Finished Email
 *
 * Tells the person who started a background asset import how it ended: either
 * every row was written (`completed`) or the import stopped part way
 * (`failed`) and can be resumed from the import page.
 *
 * Follows the React Email pattern in `stripe/audit-trial-welcome.tsx`:
 * `LogoForEmail` header, shared styles, a CTA button, a yellow notice box and
 * a plain-text twin.
 *
 * @see {@link file://./stripe/audit-trial-welcome.tsx} - Reference template
 * @see {@link file://./low-stock-alert.tsx} - Notice box example
 */

import {
  Button,
  Container,
  Head,
  Html,
  Link,
  render,
  Text,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import { db } from "~/database/db.server";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { resolveUserGreetingName } from "~/utils/user";
import { LogoForEmail } from "./logo";
import { sendEmail } from "./mail.server";
import { styles } from "./styles";

/** How an import ended. */
export type AssetImportEmailOutcome = "completed" | "failed";

/** Props shared by the HTML and plain-text renderings. */
export type AssetImportFinishedEmailProps = {
  /** Greeting name of the person who started the import */
  firstName: string;
  /** Name of the workspace the assets were imported into */
  workspaceName: string;
  /** Whether the import finished or stopped early */
  outcome: AssetImportEmailOutcome;
  /** Number of rows in the import */
  totalRows: number;
  /** Number of rows written before the import ended */
  processedRows: number;
  /** Number of rows imported with a warning */
  warningCount: number;
  /** User-facing reason the import stopped; null when it completed */
  errorMessage: string | null;
  /** Absolute link to the import page */
  importUrl: string;
};

/** Subject line for each outcome. */
const SUBJECTS: Record<AssetImportEmailOutcome, string> = {
  completed: "Your asset import is complete",
  failed: "Your asset import stopped",
};

/** Greeting prefix, tolerant of an empty name. */
const greeting = (firstName: string) =>
  `Hey${firstName ? ` ${firstName}` : ""},`;

/** Warning sentence shown in the notice box of a completed import. */
const warningSentence = (warningCount: number) =>
  `${warningCount} rows were imported with a warning, for example a barcode that was already in use. Review them on the import page.`;

/** Body sentence for a failed import. */
const failedSentence = ({
  processedRows,
  totalRows,
  workspaceName,
}: Pick<
  AssetImportFinishedEmailProps,
  "processedRows" | "totalRows" | "workspaceName"
>) =>
  `We imported ${processedRows} of ${totalRows} assets into ${workspaceName} before the import stopped.`;

/** Reassurance line shown under the error of a failed import. */
const RESUME_SENTENCE =
  "Nothing was imported twice. Open the import to resume from where it stopped.";

/**
 * Plain-text version of the asset import finished email.
 *
 * @param props - Import counts, workspace and links
 * @returns Plain text email body
 */
export const assetImportFinishedEmailText = (
  props: AssetImportFinishedEmailProps
) => {
  const { outcome, firstName, workspaceName, totalRows, warningCount } = props;

  if (outcome === "failed") {
    return `${greeting(firstName)}

${failedSentence(props)}

${props.errorMessage ?? ""}

${RESUME_SENTENCE}

Open import: ${props.importUrl}

The Shelf Team
`;
  }

  return `${greeting(firstName)}

${totalRows} assets were imported into ${workspaceName}.

View assets: ${SERVER_URL}/assets
${
  warningCount > 0
    ? `\n${warningSentence(warningCount)}\n\nReview the import: ${
        props.importUrl
      }\n`
    : ""
}
The Shelf Team
`;
};

/**
 * React Email component for the asset import finished email.
 *
 * @param props - Import counts, workspace and links
 */
function AssetImportFinishedEmailTemplate(
  props: AssetImportFinishedEmailProps
) {
  const { emailPrimaryColor } = config;
  const { outcome, firstName, workspaceName, totalRows, warningCount } = props;
  const noticeStyle = {
    ...styles.p,
    backgroundColor: "#FFF8E1",
    border: "1px solid #FFE082",
    borderRadius: "8px",
    padding: "16px",
  };
  const buttonStyle = {
    ...styles.button,
    textAlign: "center" as const,
    maxWidth: "200px",
    marginBottom: "24px",
  };

  return (
    <Html>
      <Head>
        <title>{SUBJECTS[outcome]}</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>{greeting(firstName)}</Text>

          {outcome === "failed" ? (
            <>
              <Text style={{ ...styles.p }}>{failedSentence(props)}</Text>
              <Text style={noticeStyle}>{props.errorMessage}</Text>
              <Text style={{ ...styles.p }}>{RESUME_SENTENCE}</Text>
              <Button href={props.importUrl} style={buttonStyle}>
                Open import
              </Button>
            </>
          ) : (
            <>
              <Text style={{ ...styles.p }}>
                {totalRows} assets were imported into {workspaceName}.
              </Text>
              <Button href={`${SERVER_URL}/assets`} style={buttonStyle}>
                View assets
              </Button>
              {warningCount > 0 ? (
                <Text style={noticeStyle}>
                  {warningSentence(warningCount)}{" "}
                  <Link
                    href={props.importUrl}
                    style={{ color: emailPrimaryColor }}
                  >
                    Review the import
                  </Link>
                </Text>
              ) : null}
            </>
          )}

          <Text style={{ marginTop: "24px", ...styles.p }}>The Shelf Team</Text>
        </div>
      </Container>
    </Html>
  );
}

/**
 * Renders the asset import finished email as an HTML string.
 *
 * @param props - Import counts, workspace and links
 * @returns Promise resolving to the rendered HTML string
 */
export const assetImportFinishedEmailHtml = (
  props: AssetImportFinishedEmailProps
) => render(<AssetImportFinishedEmailTemplate {...props} />);

/**
 * Loads an import with its creator and workspace and emails the creator the
 * outcome. Never throws: any failure is logged so a mail problem cannot fail
 * the import job that calls it.
 *
 * @param args.importId - The import that finished
 * @param args.organizationId - Workspace that owns the import (scopes the lookup)
 * @param args.outcome - Whether the import completed or stopped early
 */
export async function sendAssetImportFinishedEmail({
  importId,
  organizationId,
  outcome,
}: {
  importId: string;
  organizationId: string;
  outcome: AssetImportEmailOutcome;
}): Promise<void> {
  try {
    const assetImport = await db.assetImport.findFirst({
      where: { id: importId, organizationId },
      select: {
        totalRows: true,
        processedRows: true,
        warningCount: true,
        errorMessage: true,
        organization: { select: { name: true } },
        createdBy: { select: { email: true, ...USER_NAME_SELECT } },
      },
    });

    if (!assetImport) {
      throw new ShelfError({
        cause: null,
        message: "Asset import not found while sending the finished email",
        additionalData: { importId, organizationId },
        label: "Asset Import",
        shouldBeCaptured: false,
      });
    }

    const { createdBy, organization, ...counts } = assetImport;
    const props: AssetImportFinishedEmailProps = {
      ...counts,
      firstName: resolveUserGreetingName(createdBy),
      workspaceName: organization.name,
      outcome,
      importUrl: `${SERVER_URL}/assets/import/${importId}`,
    };

    const html = await assetImportFinishedEmailHtml(props);
    const text = assetImportFinishedEmailText(props);

    sendEmail({ to: createdBy.email, subject: SUBJECTS[outcome], html, text });
  } catch (cause) {
    Logger.error(
      new ShelfError({
        cause,
        message: "Something went wrong while sending the asset import email",
        additionalData: { importId, organizationId, outcome },
        label: "Asset Import",
      })
    );
  }
}
