/**
 * Low Stock Recovered Email Template
 *
 * Sends an email notification to organization owners and admins when a
 * previously low quantity-tracked asset's available quantity climbs back
 * ABOVE its configured minimum threshold (minQuantity) — i.e. the asset
 * has recovered from a low-stock condition and no longer needs attention.
 *
 * This is the sibling "recovered" notice to {@link ./low-stock-alert.tsx}
 * and follows the same React Email pattern established in
 * audit-trial-welcome.tsx: LogoForEmail header, shared styles, CTA button,
 * and dual HTML/plain-text exports.
 *
 * @see {@link file://./low-stock-alert.tsx} - The low-stock alert counterpart
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

/** Props required to render the low-stock recovered email. */
interface LowStockRecoveredProps {
  /** Display title of the asset that recovered above its threshold */
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
 * React Email component for the low-stock recovered notification.
 *
 * @param props - Asset and threshold details for the recovered notice
 */
function LowStockRecoveredTemplate({
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
  assetId,
  organizationName,
}: LowStockRecoveredProps) {
  return (
    <Html>
      <Head>
        <title>Back In Stock</title>
      </Head>

      <Container style={{ padding: "32px 16px", maxWidth: "100%" }}>
        <LogoForEmail />

        <div style={{ paddingTop: "8px" }}>
          <Text style={{ ...styles.h2 }}>Back In Stock</Text>

          <Text style={{ ...styles.p }}>
            <strong>{assetTitle}</strong> in {organizationName} is back in
            stock:{" "}
            <strong>
              {available} {unitOfMeasure}
            </strong>{" "}
            available &mdash; above your threshold of{" "}
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
            No action needed &mdash; this item is above its reorder threshold
            again.
          </Text>

          <Text style={{ marginTop: "24px", ...styles.p }}>The Shelf Team</Text>
        </div>
      </Container>
    </Html>
  );
}

/**
 * Renders the low-stock recovered email as an HTML string.
 *
 * @param props - Asset and threshold details for the recovered notice
 * @returns Promise resolving to the rendered HTML string
 */
export const lowStockRecoveredHtml = (props: LowStockRecoveredProps) =>
  render(<LowStockRecoveredTemplate {...props} />);

/**
 * Generates a plain-text version of the low-stock recovered email.
 *
 * @param props - Asset and threshold details for the recovered notice
 * @returns Plain text email body
 */
export const lowStockRecoveredText = ({
  assetTitle,
  available,
  minQuantity,
  unitOfMeasure,
  assetId,
  organizationName,
}: LowStockRecoveredProps) => `Back In Stock

${assetTitle} in ${organizationName} is back in stock: ${available} ${unitOfMeasure} available — above your threshold of ${minQuantity} ${unitOfMeasure}.

View Asset: ${SERVER_URL}/assets/${assetId}/overview

No action needed — this item is above its reorder threshold again.

The Shelf Team
`;
