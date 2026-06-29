/**
 * Low Stock Alert Email Template
 *
 * Sends an email notification to organization owners when a
 * quantity-tracked asset's available quantity drops to or below
 * its configured minimum threshold (minQuantity).
 *
 * Follows the React Email pattern established in audit-trial-welcome.tsx:
 * LogoForEmail header, shared styles, CTA button, and dual HTML/plain-text exports.
 *
 * @see {@link file://./stripe/audit-trial-welcome.tsx} - Reference email template
 * @see {@link file://../modules/consumption-log/low-stock.server.ts} - Trigger logic
 */

import {
  Button,
  Container,
  Head,
  Html,
  render,
  Text,
} from "@react-email/components";
import { SERVER_URL } from "~/utils/env";
import { LogoForEmail } from "./logo";
import { styles } from "./styles";

/** Props required to render the low-stock alert email. */
interface LowStockAlertProps {
  /** Display title of the asset that triggered the alert */
  assetTitle: string;
  /** Current available quantity (total minus in-custody) */
  available: number;
  /** The minimum quantity threshold configured on the asset */
  minQuantity: number;
  /** Unit of measure label (e.g., "units", "kg", "liters") */
  unitOfMeasure: string;
  /** Asset ID used to build the "View Asset" link */
  assetId: string;
  /** Organization name for context in the email */
  organizationName: string;
}

/**
 * React Email component for the low-stock alert notification.
 *
 * @param props - Asset and threshold details for the alert
 */
function LowStockAlertTemplate({
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
  assetId,
  organizationName,
}: LowStockAlertProps) {
  return (
    <Html>
      <Head>
        <title>Low Stock Alert</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.h2 }}>Low Stock Alert</Text>

          <Text style={{ ...styles.p }}>
            <strong>{assetTitle}</strong> in {organizationName} has dropped to{" "}
            <strong>
              {available} {unitOfMeasure}
            </strong>{" "}
            &mdash; below your threshold of{" "}
            <strong>
              {minQuantity} {unitOfMeasure}
            </strong>
            .
          </Text>

          <Button
            href={`${SERVER_URL}/assets/${assetId}/overview`}
            style={{
              ...styles.button,
              textAlign: "center" as const,
              maxWidth: "200px",
              marginBottom: "24px",
            }}
          >
            View Asset
          </Button>

          <Text
            style={{
              ...styles.p,
              backgroundColor: "#FFF8E1",
              border: "1px solid #FFE082",
              borderRadius: "8px",
              padding: "16px",
            }}
          >
            Consider restocking to maintain adequate inventory levels.
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>The Shelf Team</Text>
        </div>
      </Container>
    </Html>
  );
}

/**
 * Renders the low-stock alert email as an HTML string.
 *
 * @param props - Asset and threshold details for the alert
 * @returns Promise resolving to the rendered HTML string
 */
export const lowStockAlertHtml = (props: LowStockAlertProps) =>
  render(<LowStockAlertTemplate {...props} />);

/**
 * Generates a plain-text version of the low-stock alert email.
 *
 * @param props - Asset and threshold details for the alert
 * @returns Plain text email body
 */
export const lowStockAlertText = ({
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
  assetId,
  organizationName,
}: LowStockAlertProps) => `Low Stock Alert

${assetTitle} in ${organizationName} has dropped to ${available} ${unitOfMeasure} — below your threshold of ${minQuantity} ${unitOfMeasure}.

View Asset: ${SERVER_URL}/assets/${assetId}/overview

Consider restocking to maintain adequate inventory levels.

The Shelf Team
`;
