/**
 * Low Stock Recovered Email Template
 *
 * Sent to every owner and admin of a workspace when a quantity-tracked asset
 * that was alerted as low climbs back above its minimum (`minQuantity`). It
 * closes the episode the low-stock alert opened, so it carries the same facts:
 * what brought the stock back, where it sits, and what else is still low.
 *
 * The body is shared with the low-stock alert; this file supplies only the
 * heading, lead sentence, yellow box and preheader.
 *
 * @see {@link file://./low-stock-alert.tsx} - the alert counterpart
 * @see {@link file://./components/stock-level-email.tsx} - shared layout
 * @see {@link file://./low-stock-copy.ts} - every sentence
 * @see {@link file://../modules/consumption-log/low-stock.server.ts} - trigger and loader
 */

import { render } from "@react-email/components";
import {
  StockLevelEmail,
  stockLevelEmailText,
  type StockLevelContent,
  type StockLevelEmailProps,
} from "./components/stock-level-email";
import {
  preheader,
  RECOVERED_HEADING,
  RECOVERED_NOTICE,
  recoveredLead,
} from "./low-stock-copy";

/** Props of the back-in-stock notice: one recipient's facts. */
export type LowStockRecoveredProps = StockLevelEmailProps;

/** Heading, lead, yellow box and preheader of the back-in-stock notice. */
function recoveredContent(props: LowStockRecoveredProps): StockLevelContent {
  return {
    heading: RECOVERED_HEADING,
    lead: recoveredLead(props),
    notice: RECOVERED_NOTICE,
    preview: preheader(props),
  };
}

/**
 * Renders one recipient's back-in-stock notice as HTML.
 *
 * @param props - The recipient and the facts to print
 * @returns Promise resolving to the rendered HTML string
 */
export const lowStockRecoveredHtml = (props: LowStockRecoveredProps) =>
  render(<StockLevelEmail content={recoveredContent(props)} facts={props} />);

/**
 * Renders one recipient's back-in-stock notice as plain text.
 *
 * @param props - The recipient and the facts to print
 * @returns Plain-text email body
 */
export const lowStockRecoveredText = (props: LowStockRecoveredProps) =>
  stockLevelEmailText({ content: recoveredContent(props), facts: props });
