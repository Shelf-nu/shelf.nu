/**
 * Asset Import Finished Email
 *
 * Tells the person who started a background asset import how it ended: either
 * every row was written (`completed`) or the import stopped part way
 * (`failed`) and can be resumed from the import page.
 *
 * Uses the standard notification layout shared with
 * `audit-updates-template.tsx` and `bookings-updates-template.tsx`: centred
 * logo, h1 heading, h2 subheading, label/value lines, centred buttons, the
 * workspace's custom footer and a bordered footer block. A plain-text twin
 * carries the same information in the same order.
 *
 * @see {@link file://./audit-updates-template.tsx} - Reference layout
 * @see {@link file://./components/custom-footer.tsx} - Workspace footer text
 */

import {
  Button,
  Container,
  Head,
  Heading,
  Html,
  render,
} from "@react-email/components";
import { db } from "~/database/db.server";
import { formatAssetCount, formatCount } from "~/modules/asset-import/format";
import { USER_NAME_SELECT } from "~/modules/user/fields";
import { SERVER_URL } from "~/utils/env";
import { ShelfError } from "~/utils/error";
import { Logger } from "~/utils/logger";
import { resolveUserDisplayName } from "~/utils/user";
import { CustomEmailFooter } from "./components/custom-footer";
import { LogoForEmail } from "./logo";
import { sendEmail } from "./mail.server";
import { styles } from "./styles";

/** How an import ended. */
export type AssetImportEmailOutcome = "completed" | "failed";

/** Props shared by the HTML and plain-text renderings. */
export type AssetImportFinishedEmailProps = {
  /** Display name of the person who started the import */
  startedBy: string;
  /** Name of the workspace the assets were imported into */
  workspaceName: string;
  /** The workspace's custom email footer, when it has one */
  customEmailFooter?: string | null;
  /** Name of the uploaded CSV; null when it was not recorded */
  fileName?: string | null;
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

/** Subject line (and h1 heading) for each outcome. */
const SUBJECTS: Record<AssetImportEmailOutcome, string> = {
  completed: "Your asset import is complete",
  failed: "Your asset import stopped",
};

/** Reassurance line shown under the reason of a failed import. */
const RESUME_SENTENCE =
  "Nothing was imported twice. Open the import and choose Resume to continue where it stopped.";

/** Points to where the warnings are listed; appended to the warning count. */
const WARNING_HINT = "listed on the import page";

/** Text of the h2 subheading: file name (or "CSV import") and row count. */
const subheading = ({
  fileName,
  totalRows,
}: Pick<AssetImportFinishedEmailProps, "fileName" | "totalRows">) =>
  `${fileName?.trim() || "CSV import"} | ${formatAssetCount(totalRows)}`;

/** Value of the "Imported" line, e.g. "965 of 10,000 assets". */
const importedValue = ({
  processedRows,
  totalRows,
}: Pick<AssetImportFinishedEmailProps, "processedRows" | "totalRows">) =>
  `${formatCount(processedRows)} of ${formatAssetCount(totalRows)}`;

/** Value of the "Rows with warnings" line. */
const warningsValue = (warningCount: number) =>
  `${formatCount(warningCount)} (${WARNING_HINT})`;

/** Why the recipient received the email; shown in the footer block. */
const footerReason = (workspaceName: string) =>
  `This email was sent to you because you started this import in the workspace "${workspaceName}".`;

/**
 * Plain-text version of the asset import finished email.
 *
 * @param props - Import counts, workspace and links
 * @returns Plain text email body
 */
export const assetImportFinishedEmailText = (
  props: AssetImportFinishedEmailProps
) => {
  const { outcome, workspaceName, warningCount, startedBy } = props;
  const failed = outcome === "failed";

  const lines = [
    SUBJECTS[outcome],
    "",
    subheading(props),
    "",
    `Workspace: ${workspaceName}`,
    `Imported: ${importedValue(props)}`,
  ];
  if (warningCount > 0) {
    lines.push(`Rows with warnings: ${warningsValue(warningCount)}`);
  }
  lines.push(`Started by: ${startedBy}`);
  if (failed) {
    lines.push(`Reason: ${props.errorMessage ?? "Unknown error"}`, "");
    lines.push(RESUME_SENTENCE, "", `Open import: ${props.importUrl}`);
  } else {
    lines.push("", `View assets: ${SERVER_URL}/assets`);
    if (warningCount > 0) {
      lines.push(`View import: ${props.importUrl}`);
    }
  }
  if (props.customEmailFooter) {
    lines.push("", props.customEmailFooter);
  }
  lines.push(
    "",
    footerReason(workspaceName),
    "",
    "Thanks,",
    "The Shelf Team",
    "",
    `© ${new Date().getFullYear()} Shelf.nu`,
    ""
  );
  return lines.join("\n");
};

/** Label/value line in the style of the reference notification templates. */
function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <p style={{ ...styles.p }}>
      <span style={{ color: "#101828", fontWeight: "600" }}>{label}:</span>{" "}
      {value}
    </p>
  );
}

/**
 * React Email component for the asset import finished email.
 *
 * @param props - Import counts, workspace and links
 */
function AssetImportFinishedEmailTemplate(
  props: AssetImportFinishedEmailProps
) {
  const { outcome, workspaceName, warningCount, startedBy } = props;
  const failed = outcome === "failed";
  const showImportButton = !failed && warningCount > 0;
  const buttonStyle = {
    ...styles.button,
    textAlign: "center" as const,
    display: "inline-block",
    marginBottom: "12px",
    width: "100%",
    maxWidth: "240px",
  };

  return (
    <Html>
      <Head>
        <title>{SUBJECTS[outcome]}</title>
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
            {SUBJECTS[outcome]}
          </Heading>
          <Heading as="h2" style={{ ...styles.h2 }}>
            {subheading(props)}
          </Heading>
          <DetailLine label="Workspace" value={workspaceName} />
          <DetailLine label="Imported" value={importedValue(props)} />
          {warningCount > 0 && (
            <DetailLine
              label="Rows with warnings"
              value={warningsValue(warningCount)}
            />
          )}
          <DetailLine label="Started by" value={startedBy} />
          {failed && (
            <>
              <DetailLine
                label="Reason"
                value={props.errorMessage ?? "Unknown error"}
              />
              <p style={{ ...styles.p }}>{RESUME_SENTENCE}</p>
            </>
          )}
        </div>

        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          {failed ? (
            <Button href={props.importUrl} style={buttonStyle}>
              Open import
            </Button>
          ) : (
            <>
              <Button
                href={`${SERVER_URL}/assets`}
                style={{
                  ...buttonStyle,
                  marginRight: showImportButton ? "12px" : "0",
                }}
              >
                View assets
              </Button>
              {showImportButton && (
                <Button href={props.importUrl} style={buttonStyle}>
                  View import
                </Button>
              )}
            </>
          )}
        </div>

        <CustomEmailFooter footerText={props.customEmailFooter} />

        <div
          style={{
            marginTop: "32px",
            paddingTop: "32px",
            borderTop: "1px solid #E4E4E7",
          }}
        >
          <p
            style={{
              ...styles.p,
              marginBottom: "16px",
              fontSize: "14px",
              color: "#344054",
            }}
          >
            This email was sent to you because you started this import in the
            workspace{" "}
            <span style={{ color: "#101828", fontWeight: "600" }}>
              "{workspaceName}"
            </span>
            .
          </p>
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
        fileName: true,
        totalRows: true,
        processedRows: true,
        warningCount: true,
        errorMessage: true,
        organization: { select: { name: true, customEmailFooter: true } },
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
      startedBy: resolveUserDisplayName(createdBy) || "Unknown User",
      workspaceName: organization.name,
      customEmailFooter: organization.customEmailFooter,
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
