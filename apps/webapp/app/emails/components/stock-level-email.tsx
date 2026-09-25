/**
 * Stock Level Email Layout
 *
 * The body shared by the low-stock alert and the back-in-stock email, in HTML
 * ({@link StockLevelEmail}) and plain text ({@link stockLevelEmailText}). The
 * two mails differ only in their heading, lead sentence and yellow box, which
 * each template passes in as {@link StockLevelContent}.
 *
 * Order, top to bottom: logo, greeting, heading, lead, grey facts panel, the
 * "Open asset" button, the yellow box, sign-off, then the footer saying who got
 * the mail and why, the workspace's custom footer and the copyright line.
 *
 * All wording comes from `low-stock-copy.ts`; this file only lays it out.
 *
 * @see {@link file://../low-stock-alert.tsx} - the alert
 * @see {@link file://../low-stock-recovered.tsx} - the back-in-stock notice
 * @see {@link file://../low-stock-copy.ts} - every sentence printed here
 */

import type { CSSProperties } from "react";
import {
  Button,
  Container,
  Head,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { config } from "~/config/shelf.config";
import { CustomEmailFooter } from "./custom-footer";
import { LogoForEmail } from "../logo";
import {
  buildFactRows,
  greeting,
  recipientFooter,
  segmentsToText,
  type CopySegment,
  type StockMovement,
} from "../low-stock-copy";
import { styles } from "../styles";

/** The facts one recipient's copy of either stock email is rendered from. */
export type StockLevelEmailProps = {
  /** Who this copy goes to. Each recipient gets their own render. */
  recipient: {
    /** From `resolveUserGreetingName`; may be empty. */
    greetingName: string;
    email: string;
  };
  assetTitle: string;
  assetId: string;
  /** Total minus units in custody. Raw: may be negative; the copy clamps it. */
  available: number;
  minQuantity: number;
  /** `Asset.unitOfMeasure`; `null` and `""` both mean "no unit". */
  unitOfMeasure: string | null;
  organizationName: string;
  customEmailFooter: string | null;
  /** "What happened", already formatted in this recipient's date format. */
  movement: StockMovement | null;
  /** "Where it is", from `describePlacements`. */
  placements: string;
  /** Units of this asset held in custody. */
  inCustody: number;
  /** Other assets in the workspace at or below their minimum. */
  otherLowCount: number;
  /** Base URL for every link, without a trailing slash. */
  serverUrl: string;
};

/** What distinguishes the alert from the back-in-stock mail. */
export type StockLevelContent = {
  heading: string;
  lead: CopySegment[];
  notice: string;
  preview: string;
};

const labelStyle = {
  ...styles.p,
  margin: "0",
  fontSize: "14px",
  fontWeight: "600",
  color: "#101828",
};

/** Long location names and URLs must wrap, not widen the mail on a phone. */
const valueStyle = {
  ...styles.p,
  margin: "4px 0 0",
  overflowWrap: "anywhere" as const,
  wordBreak: "break-word" as const,
};

const footerStyle = { fontSize: "14px", color: "#344054" };

/**
 * Renders runs of copy, bolding the bold ones. Recursive rather than mapped:
 * runs can repeat (a lead may bold "5 Units" twice), so there is no stable key.
 */
function Segments({
  segments,
  boldStyle,
}: {
  segments: CopySegment[];
  boldStyle?: CSSProperties;
}) {
  const [first, ...rest] = segments;
  if (!first) {
    return null;
  }
  return (
    <>
      {first.bold ? (
        <strong style={boldStyle}>{first.text}</strong>
      ) : (
        first.text
      )}
      <Segments segments={rest} boldStyle={boldStyle} />
    </>
  );
}

/**
 * One recipient's copy of a stock email, as React Email markup.
 *
 * @param props.content - Heading, lead, yellow box and preheader of this mail
 * @param props.facts - The facts to print for this recipient
 */
export function StockLevelEmail({
  content,
  facts,
}: {
  content: StockLevelContent;
  facts: StockLevelEmailProps;
}) {
  const { emailPrimaryColor } = config;
  const rows = buildFactRows(facts);

  return (
    <Html>
      <Head>
        <title>{content.heading}</title>
      </Head>
      <Preview>{content.preview}</Preview>

      <Container
        style={{ padding: "32px 16px", maxWidth: "600px", margin: "0 auto" }}
      >
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.p }}>
            {greeting(facts.recipient.greetingName)}
          </Text>

          <Text style={{ ...styles.h2 }}>{content.heading}</Text>

          <Text style={{ ...styles.p }}>
            <Segments segments={content.lead} />
          </Text>

          <Section
            style={{
              margin: "24px 0",
              backgroundColor: "#F9FAFB",
              borderRadius: "8px",
              border: "1px solid #EAECF0",
              padding: "8px 20px",
            }}
          >
            {rows.map((row, index) => (
              <div
                key={row.label}
                style={{
                  padding: "10px 0",
                  borderBottom:
                    index < rows.length - 1 ? "1px solid #EAECF0" : "none",
                }}
              >
                <p style={labelStyle}>{row.label}</p>
                <p style={valueStyle}>{row.value}</p>
                {row.link ? (
                  <p style={valueStyle}>
                    <Link
                      href={`${facts.serverUrl}${row.link.href}`}
                      style={{ color: emailPrimaryColor }}
                    >
                      {row.link.text}
                    </Link>
                  </p>
                ) : null}
              </div>
            ))}
          </Section>

          {/* Centred so the button reads as the one action at any width. */}
          <Section style={{ textAlign: "center", marginBottom: "24px" }}>
            <Button
              href={`${facts.serverUrl}/assets/${facts.assetId}/overview`}
              style={{ ...styles.button, textAlign: "center" as const }}
            >
              Open asset
            </Button>
          </Section>

          <Text
            style={{
              ...styles.p,
              backgroundColor: "#FFF8E1",
              border: "1px solid #FFE082",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            {content.notice}
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>The Shelf Team</Text>

          <Text style={footerStyle}>
            <Segments
              segments={recipientFooter({
                email: facts.recipient.email,
                organizationName: facts.organizationName,
              })}
              boldStyle={{ color: "#101828", fontWeight: "600" }}
            />
          </Text>
          <CustomEmailFooter footerText={facts.customEmailFooter} />
          <Text style={{ ...footerStyle, marginBottom: "32px" }}>
            © {new Date().getFullYear()} Shelf.nu
          </Text>
        </div>
      </Container>
    </Html>
  );
}

/**
 * One recipient's copy of a stock email, as plain text. Mirrors the HTML: one
 * fact per line, a blank line between blocks, links as full URLs.
 *
 * @param params.content - Heading, lead and yellow box of this mail
 * @param params.facts - The facts to print for this recipient
 * @returns The plain-text body
 */
export function stockLevelEmailText({
  content,
  facts,
}: {
  content: Omit<StockLevelContent, "preview">;
  facts: StockLevelEmailProps;
}) {
  const factLines = buildFactRows(facts).flatMap((row) => [
    `${row.label}: ${row.value}`,
    ...(row.link
      ? [`${row.link.text}: ${facts.serverUrl}${row.link.href}`]
      : []),
  ]);
  const footer = segmentsToText(
    recipientFooter({
      email: facts.recipient.email,
      organizationName: facts.organizationName,
    })
  );

  const blocks = [
    greeting(facts.recipient.greetingName),
    content.heading,
    segmentsToText(content.lead),
    factLines.join("\n"),
    `Open asset: ${facts.serverUrl}/assets/${facts.assetId}/overview`,
    content.notice,
    "The Shelf Team",
    footer,
    ...(facts.customEmailFooter ? [`---\n${facts.customEmailFooter}`] : []),
    `© ${new Date().getFullYear()} Shelf.nu`,
  ];

  return `${blocks.join("\n\n")}\n`;
}
